(function () {
  "use strict";

  // 內建預設卡片資料（與 content.json 完全一致，確保 file:// 直接開也能運作，並同時支援 fetch('./content.json')）
  let CONTENT = null;
  let SCENARIOS = {};

  const ROLES = [
    { id: "seller", name: "屋主（林家）", short: "屋主", colorClass: "role-seller", color: "#9B2A1F", single: true },
    { id: "buyer", name: "買方（陳家）", short: "買方", colorClass: "role-buyer", color: "#2F5D62", single: true },
    { id: "sagent", name: "賣方仲介", short: "賣方仲介", colorClass: "role-sagent", color: "#8B6A45", single: true },
    { id: "bagent", name: "買方仲介", short: "買方仲介", colorClass: "role-bagent", color: "#5E6B34", single: true },
    { id: "manager", name: "店長（限 1 人）", short: "店長", colorClass: "role-manager", color: "#4A3B2E", single: true },
    { id: "observer", name: "觀察者（不限人數）", short: "觀察者", colorClass: "role-observer", color: "#2B5B84", single: false }
  ];

  const OBSERVER_STAGES = [
    {
      key: "stage1",
      title: "環節一｜識局訪談與情報交換",
      placeholder: "觀察兩位仲介如何訪談客戶（有無問出 Must／Want／Give 與關鍵數字）、情報交換與找交集是否到位……"
    },
    {
      key: "stage2",
      title: "環節二｜第一輪議價與反應卡拆招",
      placeholder: "觀察第一輪開口報價、柱子論述、客戶抽反應卡時的拆招表現與換到的條件……"
    },
    {
      key: "stage3",
      title: "環節三｜第二輪議價與收斂攻防",
      placeholder: "觀察第二輪中繼報價、讓步幅度是否遞減、掛鉤句（If 條件句）運用情況……"
    },
    {
      key: "stage4",
      title: "環節四｜最後一步與店長斡旋",
      placeholder: "觀察最後一步目標價收斂過程、店長下黑上白搭橋話術與成交關鍵……"
    }
  ];

  const OBSERVER_FB_QUESTIONS = [
    {
      key: "fb1",
      title: "1. 客戶回饋觀察：哪一句話讓客戶真的想讓步？",
      placeholder: "記錄打動屋主或買方的關鍵一句話與原因"
    },
    {
      key: "fb2",
      title: "2. 條件交換觀察：哪一步有做到「換條件」？哪一步忘記換？",
      placeholder: "記錄哪一輪條件換得好、哪一輪白白讓步"
    },
    {
      key: "fb3",
      title: "3. 總結建議：如果重來一次，哪一輪的話術可以更好？",
      placeholder: "給這組業務夥伴的具體話術升級建議"
    }
  ];

  function getRoleDisplayName(roleId) {
    if (roleId === "seller") {
      if (state.scenario === "banqiao") return "屋主（張家）";
      if (state.scenario === "zhongshan") return "屋主（高董）";
      return "屋主（林家）";
    }
    if (roleId === "buyer") {
      if (state.scenario === "banqiao") return "買方（周家）";
      if (state.scenario === "zhongshan") return "買方（許醫師）";
      return "買方（陳家）";
    }
    const r = ROLES.find((x) => x.id === roleId);
    return r ? r.name : roleId;
  }

  const TABS = [
    { id: "room", label: "房間" },
    { id: "rules", label: "說明" },
    { id: "case", label: "情境" },
    { id: "seller", label: "屋主", dot: "#9B2A1F" },
    { id: "buyer", label: "買方", dot: "#2F5D62" },
    { id: "sagent", label: "賣方仲介", dot: "#8B6A45" },
    { id: "bagent", label: "買方仲介", dot: "#5E6B34" },
    { id: "manager", label: "店長", dot: "#4A3B2E" },
    { id: "observer", label: "觀察者", dot: "#2B5B84" },
    { id: "board", label: "議價看板" }
  ];

  const ROUND_LABELS = ["第一輪", "第二輪", "最後一步"];

  const LS_SESSION_KEY = "jingmei_session_v1";
  const LS_NOTES_KEY = "jingmei_notes_v1";
  const LS_LOCAL_ROOMS_KEY = "jingmei_local_rooms_v1";

  // 記錄已展開的子夾 ID，避免即時同步重繪時把使用者點開的子夾自動收合
  const openSubfolderIds = new Set();
  let lockToastTimer = null;
  let lockToastMsg = "";

  // 狀態
  let state = {
    tab: "room",
    scenario: "jingmei",
    uid: null,
    roomCode: "",
    nick: "",
    role: "seller",
    joined: false,
    firebaseReady: false,
    firebaseConnected: false,
    revealSellerRole: false,
    revealBuyerRole: false,
    clientRoundView: { seller: 0, buyer: 0 },
    previewCardIdx: { seller: null, buyer: null },
    agentDraft: {
      sagent: { offer: "", intel: "", currentDraftId: null },
      bagent: { offer: "", intel: "", currentDraftId: null }
    },
    resetConfirmUntil: 0,
    roomData: null,
    notes: null
  };
  state.roomData = createEmptyRoomData();
  state.notes = loadNotes();

  function isGameEnded() {
    const deal = state.roomData && state.roomData.manager ? state.roomData.manager.deal : null;
    return deal !== null && deal !== undefined && deal !== "";
  }

  function isGameStarted() {
    if (!state.roomData || !state.roomData.manager) return false;
    return !!(state.roomData.manager.started || isGameEnded());
  }

  function getRoomRoleReadiness() {
    const playersMap = (state.roomData && state.roomData.players) || {};
    const onlinePlayers = Object.values(playersMap).filter((p) => p && p.online);
    const coreRoleIds = ["seller", "buyer", "sagent", "bagent", "manager"];
    const coreRoles = coreRoleIds.map((rId) => {
      const rObj = ROLES.find((r) => r.id === rId) || { id: rId, short: rId, color: "#4A3B2E", colorClass: "role-manager" };
      const holders = onlinePlayers.filter((p) => p.role === rId).map((p) => p.nick || "學員");
      return {
        id: rId,
        short: rObj.short,
        displayName: getRoleDisplayName(rId),
        color: rObj.color,
        colorClass: rObj.colorClass,
        holders,
        ready: holders.length > 0
      };
    });
    const missingRoles = coreRoles.filter((r) => !r.ready).map((r) => r.short);
    const readyCount = coreRoles.filter((r) => r.ready).length;
    return {
      coreRoles,
      missingRoles,
      readyCount,
      totalRequired: coreRoles.length,
      allReady: missingRoles.length === 0
    };
  }

  function canAccessTab(tabId) {
    const publicTabs = ["room", "rules", "case", "board"];
    if (publicTabs.includes(tabId)) return true;
    if (isGameEnded()) return true;
    if (state.role === "manager" || state.role === "observer") return true;
    return tabId === state.role;
  }

  function showLockToast(msg) {
    lockToastMsg = msg;
    if (lockToastTimer) clearTimeout(lockToastTimer);
    const toastEl = document.getElementById("lock-toast-banner");
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.style.display = "flex";
    }
    lockToastTimer = setTimeout(() => {
      lockToastMsg = "";
      const el = document.getElementById("lock-toast-banner");
      if (el) el.style.display = "none";
    }, 4500);
  }

  let db = null;
  let roomRef = null;
  let connectedRef = null;
  let bc = null;
  let mqttClient = null;
  let mqttConnected = false;
  let currentMqttTopic = null;

  function initScenarios(jingmeiData) {
    SCENARIOS = {
      jingmei: Object.assign(
        {
          id: "jingmei",
          badge: "劇本一｜換屋 vs 學區",
          shortTitle: "景美三房",
          subtitle: "換屋帶孫 vs 學區首購（開價 2,200 萬 vs 斡旋 1,800 萬）"
        },
        jingmeiData
      )
    };
    if (window.EXTRA_SCENARIOS) {
      Object.assign(SCENARIOS, window.EXTRA_SCENARIOS);
    }
    if (!SCENARIOS[state.scenario]) {
      state.scenario = "jingmei";
    }
    CONTENT = SCENARIOS[state.scenario];
    state.notes = loadNotes();
  }

  function setScenario(scenarioId, syncToRoom) {
    if (!SCENARIOS[scenarioId]) return;
    const changed = state.scenario !== scenarioId;
    state.scenario = scenarioId;
    CONTENT = SCENARIOS[scenarioId];
    if ( state.roomData && state.roomData.meta ) {
      state.roomData.meta.scenario = scenarioId;
    }
    if (changed) {
      state.revealSellerRole = false;
      state.revealBuyerRole = false;
      state.previewCardIdx = { seller: null, buyer: null };
      state.notes = loadNotes();
    }
    saveSession();
    if (syncToRoom && state.roomCode) {
      writeRoomPatch("meta/scenario", scenarioId);
    } else {
      renderAll();
    }
  }

  function createEmptyClientNode() {
    return {
      rounds: {
        "0": { price: null, cond: "", card: null },
        "1": { price: null, cond: "", card: null },
        "2": { price: null, cond: "", card: null }
      },
      deck: {
        left: [0, 1, 2, 3, 4, 5, 6, 7],
        drawn: []
      },
      by: null
    };
  }

  function createEmptyAgentNode() {
    return {
      intel: "",
      offer: null,
      draftIntel: "",
      draftOffer: "",
      history: [],
      by: null,
      byNick: "",
      notes: null,
      notesUpdatedAt: 0
    };
  }

  function createEmptyRoomData() {
    return {
      meta: { createdAt: Date.now(), updatedAt: Date.now(), resetId: 0, scenario: state ? state.scenario || "jingmei" : "jingmei" },
      players: {},
      manager: { started: false, round: 0, deal: null, by: null, updatedAt: 0 },
      clients: {
        seller: createEmptyClientNode(),
        buyer: createEmptyClientNode()
      },
      agents: {
        sagent: createEmptyAgentNode(),
        bagent: createEmptyAgentNode()
      },
      observers: {}
    };
  }

  function getTargetPriceStr() {
    if (CONTENT && CONTENT.CASE && CONTENT.CASE.target) {
      return String(CONTENT.CASE.target);
    }
    return "2000";
  }

  function createDefaultAgentNotes() {
    return {
      tasks: [false, false, false, false, false, false],
      explore: ["", "", "", "", "", "", "", ""],
      intel: ["", "", ""],
      cross: [
        { care: "", give: "", hook: "" },
        { care: "", give: "", hook: "" },
        { care: "", give: "", hook: "" }
      ],
      ladder: [
        { price: "", pillars: [], arg: "", cond: "", next: "" },
        { price: "", pillars: [], arg: "", cond: "", next: "" },
        { price: "", pillars: [], arg: "", cond: "", next: "" },
        { price: "", pillars: [], arg: "", cond: "", next: "" }
      ],
      logs: [
        { card: "", price: "", reply: "", cond: "" },
        { card: "", price: "", reply: "", cond: "" },
        { card: "", price: "", reply: "", cond: "" }
      ]
    };
  }

  function createDefaultObserverNotes() {
    return {
      s_checks: [false, false, false, false, false, false],
      b_checks: [false, false, false, false, false, false],
      stages: {
        stage1: "",
        stage2: "",
        stage3: "",
        stage4: ""
      },
      fb1: "",
      fb2: "",
      fb3: ""
    };
  }

  function createDefaultNotes() {
    return {
      sagent: createDefaultAgentNotes(),
      bagent: createDefaultAgentNotes(),
      manager: {
        s_checks: [false, false, false, false, false, false],
        b_checks: [false, false, false, false, false, false],
        stages: {
          stage1: "",
          stage2: "",
          stage3: "",
          stage4: ""
        },
        dealNote: "",
        fb1: "",
        fb2: "",
        fb3: ""
      },
      observer: createDefaultObserverNotes(),
      manualBoard: {
        seller: [
          { price: "", cond: "" },
          { price: "", cond: "" },
          { price: "", cond: "" }
        ],
        buyer: [
          { price: "", cond: "" },
          { price: "", cond: "" },
          { price: "", cond: "" }
        ]
      }
    };
  }

  function getNotesStorageKey() {
    const sc = (state && state.scenario) || "jingmei";
    return sc === "jingmei" ? LS_NOTES_KEY : `${LS_NOTES_KEY}_${sc}`;
  }

  function loadNotes() {
    try {
      const key = getNotesStorageKey();
      const raw = localStorage.getItem(key);
      if (!raw) return createDefaultNotes();
      const parsed = JSON.parse(raw);
      const def = createDefaultNotes();
      const merged = Object.assign(def, parsed);
      merged.manager = Object.assign(createDefaultNotes().manager, parsed.manager || {});
      merged.manager.stages = Object.assign({ stage1: "", stage2: "", stage3: "", stage4: "" }, (parsed.manager && parsed.manager.stages) || {});
      merged.observer = Object.assign(createDefaultObserverNotes(), parsed.observer || {});
      merged.observer.stages = Object.assign({ stage1: "", stage2: "", stage3: "", stage4: "" }, (parsed.observer && parsed.observer.stages) || {});
      const targetStr = getTargetPriceStr();
      // 若舊版快取在「目標」欄有自動預填值且尚未填寫論述/條件，自動清空讓仲介自己手填
      ["sagent", "bagent"].forEach((aKey) => {
        const r2 = merged[aKey] && merged[aKey].ladder && merged[aKey].ladder[2];
        if (r2 && r2.price === targetStr && !r2.arg && !r2.cond && (!r2.pillars || r2.pillars.length === 0)) {
          r2.price = "";
        }
      });
      return merged;
    } catch (e) {
      return createDefaultNotes();
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(getNotesStorageKey(), JSON.stringify(state.notes));
    } catch (e) {}
  }

  function loadSession() {
    try {
      let uid = localStorage.getItem("jingmei_uid_v1");
      if (!uid) {
        uid = "u_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("jingmei_uid_v1", uid);
      }
      state.uid = uid;
      const raw = localStorage.getItem(LS_SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.scenario) state.scenario = String(s.scenario);
        if (s.nick) state.nick = String(s.nick).slice(0, 20);
        if (s.roomCode) state.roomCode = normalizeRoomCode(s.roomCode);
        if (s.role && ROLES.some((r) => r.id === s.role)) state.role = s.role;
        if (s.joined && state.roomCode && state.nick) {
          state.joined = true;
        }
      }
    } catch (e) {}

    // 檢查網址 ?room= 與 ?scenario= 參數
    const params = new URLSearchParams(window.location.search);
    const urlScenario = params.get("scenario");
    if (urlScenario && ["jingmei", "banqiao", "zhongshan"].includes(urlScenario)) {
      state.scenario = urlScenario;
    }
    const urlRoom = params.get("room");
    if (urlRoom) {
      const clean = normalizeRoomCode(urlRoom);
      if (clean.length >= 2 && clean.length <= 12) {
        state.roomCode = clean;
      }
    }
  }

  function saveSession() {
    try {
      localStorage.setItem(
        LS_SESSION_KEY,
        JSON.stringify({
          scenario: state.scenario,
          roomCode: state.roomCode,
          nick: state.nick,
          role: state.role,
          joined: state.joined
        })
      );
    } catch (e) {}
  }

  function normalizeRoomCode(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 12);
  }

  function sanitizePrice(val) {
    if (val === "" || val === null || val === undefined) return null;
    const n = Number(String(val).replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(5000, Math.round(n)));
  }

  function formatNum(val) {
    if (val === null || val === undefined || val === "") return "—";
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val);
    return n.toLocaleString("zh-TW");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ==================== Firebase 與本機跨分頁同步 ====================
  function isFirebaseConfigured() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey || !cfg.databaseURL) return false;
    if (cfg.apiKey.includes("YOUR_") || cfg.databaseURL.includes("YOUR_")) return false;
    return typeof window.firebase !== "undefined";
  }

  function initSyncEngine() {
    // 同機跨視窗 BroadcastChannel（當尚未設定 Firebase 時，仍可在同一台電腦多視窗測試所有多人驗收項目）
    if ("BroadcastChannel" in window) {
      bc = new BroadcastChannel("jingmei_game_channel");
      bc.onmessage = (ev) => {
        if (!state.firebaseReady && ev.data && ev.data.roomCode === state.roomCode && state.joined) {
          loadLocalRoom(state.roomCode);
          renderAll();
        }
      };
    }
    window.addEventListener("storage", (ev) => {
      if (!state.firebaseReady && ev.key === LS_LOCAL_ROOMS_KEY && state.joined) {
        loadLocalRoom(state.roomCode);
        renderAll();
      }
    });
    window.addEventListener("online", () => renderStatusBar());
    window.addEventListener("offline", () => renderStatusBar());

    // 離線狀態清理（視窗關閉時標記為離線）
    window.addEventListener("beforeunload", () => {
      if (state.joined && state.roomCode && !state.firebaseReady) {
        markLocalPlayerOnline(false);
        publishMqttRoomState();
      }
    });

    if (!isFirebaseConfigured()) {
      state.firebaseReady = false;
      state.firebaseConnected = false;
      initMqttFallback();
      if (state.joined && state.roomCode) {
        joinRoomInternal(state.roomCode);
      }
      renderAll();
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      db = firebase.database();
      firebase
        .auth()
        .signInAnonymously()
        .then((cred) => {
          if (cred && cred.user && cred.user.uid) {
            state.uid = cred.user.uid;
          }
          state.firebaseReady = true;
          connectedRef = db.ref(".info/connected");
          connectedRef.on("value", (snap) => {
            state.firebaseConnected = !!snap.val();
            if (state.firebaseConnected && state.joined && state.roomCode) {
              updatePlayerPresence();
            }
            renderStatusBar();
          });
          if (state.joined && state.roomCode) {
            joinRoomInternal(state.roomCode);
          } else {
            renderAll();
          }
        })
        .catch((err) => {
          console.warn("Firebase Anonymous Auth 失敗，切換為單機模式：", err);
          state.firebaseReady = false;
          state.firebaseConnected = false;
          if (state.joined && state.roomCode) {
            joinRoomInternal(state.roomCode);
          }
          renderAll();
        });
    } catch (e) {
      console.warn("Firebase 初始化失敗，切換為單機模式：", e);
      state.firebaseReady = false;
      state.firebaseConnected = false;
      if (state.joined && state.roomCode) {
        joinRoomInternal(state.roomCode);
      }
      renderAll();
    }
  }

  function normalizeAgentHistoryList(rawHist, fallbackOffer, fallbackIntel, fallbackNick) {
    const arr = Array.isArray(rawHist)
      ? rawHist
      : rawHist && typeof rawHist === "object"
      ? Object.values(rawHist)
      : [];
    const seenIds = new Set();
    const list = [];
    arr.forEach((h, idx) => {
      if (!h || typeof h !== "object") return;
      const offerNum = h.offer !== undefined && h.offer !== null && h.offer !== "" ? Number(h.offer) : null;
      const intelStr = h.intel ? String(h.intel).trim() : "";
      if (offerNum === null && !intelStr) return;
      const id = String(h.id || `msg_${h.ts || idx}_${idx}`);
      if (seenIds.has(id)) return;
      seenIds.add(id);
      const rIdx = h.round !== undefined && h.round !== null ? Number(h.round) : 0;
      list.push({
        id,
        round: rIdx,
        roundLabel: String(h.roundLabel || ROUND_LABELS[rIdx] || "第一輪"),
        offer: offerNum,
        intel: intelStr,
        byNick: h.byNick ? String(h.byNick) : fallbackNick || "",
        ts: Number(h.ts || 0)
      });
    });

    // 若舊格式或單筆欄位有值且尚未存在於 history，自動補入確保不遺失
    const fbOffer = fallbackOffer !== undefined && fallbackOffer !== null && fallbackOffer !== "" ? Number(fallbackOffer) : null;
    const fbIntel = fallbackIntel ? String(fallbackIntel).trim() : "";
    if (fbOffer !== null || fbIntel) {
      const alreadyExists = list.some(
        (item) =>
          (fbOffer === null || item.offer === fbOffer) &&
          (!fbIntel || item.intel === fbIntel)
      );
      if (!alreadyExists) {
        list.push({
          id: `legacy_${fbOffer !== null ? fbOffer : "no"}_${fbIntel.slice(0, 16)}`,
          round: 0,
          roundLabel: "已傳送",
          offer: fbOffer,
          intel: fbIntel,
          byNick: fallbackNick || "",
          ts: 1
        });
      }
    }

    list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return list;
  }

  function hasAnyAgentNotesContent(notes) {
    if (!notes || typeof notes !== "object") return false;
    if (Array.isArray(notes.tasks) && notes.tasks.some(Boolean)) return true;
    if (Array.isArray(notes.explore) && notes.explore.some((x) => String(x || "").trim().length > 0)) return true;
    if (Array.isArray(notes.intel) && notes.intel.some((x) => String(x || "").trim().length > 0)) return true;
    if (Array.isArray(notes.cross) && notes.cross.some((c) => c && (c.care || c.give || c.hook))) return true;
    if (
      Array.isArray(notes.ladder) &&
      notes.ladder.some((l) => l && (l.price || l.arg || l.cond || l.next || (Array.isArray(l.pillars) && l.pillars.length > 0)))
    ) {
      return true;
    }
    if (Array.isArray(notes.logs) && notes.logs.some((lg) => lg && (lg.card || lg.price || lg.reply || lg.cond))) return true;
    return false;
  }

  function mergeAgentNotesObjects(primaryNotes, fallbackNotes) {
    const base = createDefaultAgentNotes();
    const p = primaryNotes && typeof primaryNotes === "object" ? primaryNotes : null;
    const f = fallbackNotes && typeof fallbackNotes === "object" ? fallbackNotes : null;
    if (!p && !f) return null;
    if (p && !f) return Object.assign(base, p);
    if (!p && f) return Object.assign(base, f);

    const out = createDefaultAgentNotes();
    out.tasks = [0, 1, 2, 3, 4, 5].map((i) => !!((p.tasks && p.tasks[i]) || (f.tasks && f.tasks[i])));
    out.explore = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const pv = p.explore && p.explore[i] ? String(p.explore[i]) : "";
      const fv = f.explore && f.explore[i] ? String(f.explore[i]) : "";
      return pv || fv;
    });
    out.intel = [0, 1, 2].map((i) => {
      const pv = p.intel && p.intel[i] ? String(p.intel[i]) : "";
      const fv = f.intel && f.intel[i] ? String(f.intel[i]) : "";
      return pv || fv;
    });
    out.cross = [0, 1, 2].map((i) => {
      const pc = (p.cross && p.cross[i]) || {};
      const fc = (f.cross && f.cross[i]) || {};
      return {
        care: String(pc.care || fc.care || ""),
        give: String(pc.give || fc.give || ""),
        hook: String(pc.hook || fc.hook || "")
      };
    });
    out.ladder = [0, 1, 2, 3].map((i) => {
      const pl = (p.ladder && p.ladder[i]) || {};
      const fl = (f.ladder && f.ladder[i]) || {};
      const pPillars = Array.isArray(pl.pillars) ? pl.pillars : [];
      const fPillars = Array.isArray(fl.pillars) ? fl.pillars : [];
      return {
        price: String(pl.price || fl.price || ""),
        pillars: pPillars.length > 0 ? pPillars : fPillars,
        arg: String(pl.arg || fl.arg || ""),
        cond: String(pl.cond || fl.cond || ""),
        next: String(pl.next || fl.next || "")
      };
    });
    out.logs = [0, 1, 2].map((i) => {
      const pg = (p.logs && p.logs[i]) || {};
      const fg = (f.logs && f.logs[i]) || {};
      return {
        card: String(pg.card || fg.card || ""),
        price: String(pg.price || fg.price || ""),
        reply: String(pg.reply || fg.reply || ""),
        cond: String(pg.cond || fg.cond || "")
      };
    });
    return out;
  }

  function normalizeRoomData(raw) {
    const base = createEmptyRoomData();
    if (!raw || typeof raw !== "object") return base;
    if (raw.meta) {
      base.meta = Object.assign(base.meta, raw.meta);
      if (raw.meta.scenario && SCENARIOS[raw.meta.scenario] && raw.meta.scenario !== state.scenario) {
        state.scenario = raw.meta.scenario;
        CONTENT = SCENARIOS[state.scenario];
        state.notes = loadNotes();
        saveSession();
      }
    }
    if (raw.players && typeof raw.players === "object") base.players = raw.players;
    if (raw.manager && typeof raw.manager === "object") {
      const dealNum = raw.manager.deal !== undefined && raw.manager.deal !== null && raw.manager.deal !== "" ? Number(raw.manager.deal) : null;
      base.manager = {
        started: !!(raw.manager.started || dealNum !== null),
        round: raw.manager.round !== undefined && raw.manager.round !== null ? Number(raw.manager.round) : 0,
        deal: dealNum,
        by: raw.manager.by || null,
        updatedAt: Number(raw.manager.updatedAt || 0)
      };
    }
    ["seller", "buyer"].forEach((cKey) => {
      const src = raw.clients && raw.clients[cKey];
      if (src) {
        ["0", "1", "2"].forEach((rKey) => {
          const rObj = src.rounds && src.rounds[rKey];
          if (rObj) {
            base.clients[cKey].rounds[rKey] = {
              price: rObj.price !== undefined && rObj.price !== null && rObj.price !== "" ? Number(rObj.price) : null,
              cond: rObj.cond ? String(rObj.cond) : "",
              card: rObj.card !== undefined && rObj.card !== null && rObj.card !== "" ? Number(rObj.card) : null
            };
          }
        });
        if (src.deck) {
          const drawn = Array.isArray(src.deck.drawn) ? src.deck.drawn.map(Number) : [];
          let left = Array.isArray(src.deck.left) ? src.deck.left.map(Number) : null;
          if (!left) {
            left = drawn.length > 0 ? [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => !drawn.includes(x)) : [0, 1, 2, 3, 4, 5, 6, 7];
          }
          base.clients[cKey].deck = { left, drawn };
        }
        base.clients[cKey].by = src.by || null;
      }
    });
    ["sagent", "bagent"].forEach((aKey) => {
      const src = raw.agents && raw.agents[aKey];
      if (src) {
        const byNick = src.byNick ? String(src.byNick) : "";
        const rawOffer = src.offer !== undefined && src.offer !== null && src.offer !== "" ? Number(src.offer) : null;
        const rawIntel = src.intel ? String(src.intel) : "";
        const history = normalizeAgentHistoryList(src.history, rawOffer, rawIntel, byNick);
        let latestOffer = rawOffer;
        let latestIntel = rawIntel;
        for (let i = history.length - 1; i >= 0; i--) {
          if (latestOffer === null && history[i].offer !== null) latestOffer = history[i].offer;
          if (!latestIntel && history[i].intel) latestIntel = history[i].intel;
        }
        base.agents[aKey] = {
          intel: latestIntel,
          offer: latestOffer,
          draftIntel: src.draftIntel ? String(src.draftIntel) : "",
          draftOffer: src.draftOffer !== undefined && src.draftOffer !== null ? String(src.draftOffer) : "",
          history,
          by: src.by || null,
          byNick,
          notes: src.notes && typeof src.notes === "object" ? mergeAgentNotesObjects(src.notes, null) : null,
          notesUpdatedAt: Number(src.notesUpdatedAt || 0)
        };
      }
    });
    if (raw.observers && typeof raw.observers === "object") {
      Object.entries(raw.observers).forEach(([uKey, oVal]) => {
        if (oVal && typeof oVal === "object") {
          base.observers[uKey] = {
            uid: oVal.uid || uKey,
            nick: oVal.nick ? String(oVal.nick) : "觀察者",
            role: oVal.role || "observer",
            updatedAt: Number(oVal.updatedAt || 0),
            s_checks: Array.isArray(oVal.s_checks) ? oVal.s_checks.map(Boolean) : [false, false, false, false, false, false],
            b_checks: Array.isArray(oVal.b_checks) ? oVal.b_checks.map(Boolean) : [false, false, false, false, false, false],
            stages: Object.assign({ stage1: "", stage2: "", stage3: "", stage4: "" }, oVal.stages || {}),
            fb1: oVal.fb1 ? String(oVal.fb1) : "",
            fb2: oVal.fb2 ? String(oVal.fb2) : "",
            fb3: oVal.fb3 ? String(oVal.fb3) : ""
          };
        }
      });
    }
    return base;
  }

  // 合併兩份房間資料：確保遊戲中左邊出現過的仲介傳話與各角色填寫內容絕不被新進房間裝置覆蓋或刪除
  function mergeRoomData(curRaw, incRaw) {
    const cur = normalizeRoomData(curRaw);
    const inc = normalizeRoomData(incRaw);
    const curReset = Number((cur.meta && cur.meta.resetId) || 0);
    const incReset = Number((inc.meta && inc.meta.resetId) || 0);
    if (incReset > curReset) return inc;
    if (curReset > incReset) return cur;

    const out = createEmptyRoomData();
    const curTime = Number((cur.meta && cur.meta.updatedAt) || 0);
    const incTime = Number((inc.meta && inc.meta.updatedAt) || 0);
    out.meta = {
      createdAt: Math.min(cur.meta.createdAt || Date.now(), inc.meta.createdAt || Date.now()),
      updatedAt: Math.max(curTime, incTime),
      resetId: curReset,
      scenario: incTime >= curTime ? inc.meta.scenario || cur.meta.scenario : cur.meta.scenario || inc.meta.scenario
    };

    // 合併 players
    const allPlayerIds = new Set([...Object.keys(cur.players || {}), ...Object.keys(inc.players || {})]);
    allPlayerIds.forEach((uid) => {
      const cp = cur.players && cur.players[uid];
      const ip = inc.players && inc.players[uid];
      if (cp && ip) {
        out.players[uid] = Number(ip.lastSeen || 0) >= Number(cp.lastSeen || 0) ? ip : cp;
      } else {
        out.players[uid] = ip || cp;
      }
    });

    // 合併 manager
    const cm = cur.manager || {};
    const im = inc.manager || {};
    if (Number(im.updatedAt || 0) > Number(cm.updatedAt || 0)) {
      out.manager = Object.assign({}, im);
    } else if (Number(cm.updatedAt || 0) > Number(im.updatedAt || 0)) {
      out.manager = Object.assign({}, cm);
    } else {
      const mergedDeal = im.deal !== null && im.deal !== undefined ? im.deal : cm.deal;
      out.manager = {
        started: !!(cm.started || im.started || mergedDeal !== null),
        round: Math.max(Number(cm.round || 0), Number(im.round || 0)),
        deal: mergedDeal,
        by: im.by || cm.by || null,
        updatedAt: Math.max(Number(cm.updatedAt || 0), Number(im.updatedAt || 0))
      };
    }

    // 合併 clients
    ["seller", "buyer"].forEach((cKey) => {
      const cc = cur.clients[cKey];
      const ic = inc.clients[cKey];
      ["0", "1", "2"].forEach((rKey) => {
        const cr = (cc && cc.rounds && cc.rounds[rKey]) || { price: null, cond: "", card: null };
        const ir = (ic && ic.rounds && ic.rounds[rKey]) || { price: null, cond: "", card: null };
        out.clients[cKey].rounds[rKey] = {
          price: ir.price !== null && ir.price !== undefined ? ir.price : cr.price,
          cond: ir.cond ? ir.cond : cr.cond,
          card: ir.card !== null && ir.card !== undefined ? ir.card : cr.card
        };
      });
      const cDrawn = (cc && cc.deck && cc.deck.drawn) || [];
      const iDrawn = (ic && ic.deck && ic.deck.drawn) || [];
      out.clients[cKey].deck = iDrawn.length >= cDrawn.length ? ic.deck : cc.deck;
      out.clients[cKey].by = ic.by || cc.by || null;
    });

    // 合併 agents（保留所有歷史傳話紀錄，遊戲中絕不刪除）
    ["sagent", "bagent"].forEach((aKey) => {
      const ca = cur.agents[aKey] || createEmptyAgentNode();
      const ia = inc.agents[aKey] || createEmptyAgentNode();
      const combinedHist = [...(ca.history || []), ...(ia.history || [])];
      const byId = new Map();
      const bySig = new Set();
      combinedHist.forEach((h) => {
        if (!h) return;
        const sig = `${h.offer !== null ? h.offer : ""}|${h.intel || ""}|${h.round || 0}`;
        if (byId.has(h.id)) {
          const prev = byId.get(h.id);
          byId.set(h.id, {
            id: h.id,
            round: h.round !== undefined ? h.round : prev.round,
            roundLabel: h.roundLabel || prev.roundLabel,
            offer: h.offer !== null && h.offer !== undefined ? h.offer : prev.offer,
            intel: h.intel ? h.intel : prev.intel,
            byNick: h.byNick || prev.byNick || ia.byNick || ca.byNick || "",
            ts: Math.max(Number(h.ts || 0), Number(prev.ts || 0))
          });
        } else if (!bySig.has(sig)) {
          bySig.add(sig);
          byId.set(h.id, h);
        }
      });
      const mergedHist = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      let latestOffer = ia.offer !== null && ia.offer !== undefined ? ia.offer : ca.offer;
      let latestIntel = ia.intel ? ia.intel : ca.intel;
      for (let i = mergedHist.length - 1; i >= 0; i--) {
        if (latestOffer === null && mergedHist[i].offer !== null) latestOffer = mergedHist[i].offer;
        if (!latestIntel && mergedHist[i].intel) latestIntel = mergedHist[i].intel;
      }
      const incNewer = Number(ia.notesUpdatedAt || 0) >= Number(ca.notesUpdatedAt || 0);
      const mergedNotes = incNewer
        ? mergeAgentNotesObjects(ia.notes, ca.notes)
        : mergeAgentNotesObjects(ca.notes, ia.notes);

      out.agents[aKey] = {
        intel: latestIntel || "",
        offer: latestOffer !== undefined ? latestOffer : null,
        draftIntel: incNewer ? ia.draftIntel || ca.draftIntel || "" : ca.draftIntel || ia.draftIntel || "",
        draftOffer: incNewer ? ia.draftOffer || ca.draftOffer || "" : ca.draftOffer || ia.draftOffer || "",
        history: mergedHist,
        by: ia.by || ca.by || null,
        byNick: ia.byNick || ca.byNick || "",
        notes: mergedNotes,
        notesUpdatedAt: Math.max(Number(ca.notesUpdatedAt || 0), Number(ia.notesUpdatedAt || 0))
      };
    });

    // 合併 observers
    const allObsKeys = new Set([...Object.keys(cur.observers || {}), ...Object.keys(inc.observers || {})]);
    allObsKeys.forEach((k) => {
      const co = cur.observers && cur.observers[k];
      const io = inc.observers && inc.observers[k];
      if (co && io) {
        out.observers[k] = Number(io.updatedAt || 0) >= Number(co.updatedAt || 0) ? io : co;
      } else {
        out.observers[k] = io || co;
      }
    });

    return out;
  }

  // 本機備援房間存取（支援未設定 Firebase 時同台電腦跨分頁同步）
  function getAllLocalRooms() {
    try {
      const raw = localStorage.getItem(LS_LOCAL_ROOMS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function loadLocalRoom(code) {
    const all = getAllLocalRooms();
    if (all[code]) {
      state.roomData = mergeRoomData(state.roomData, all[code]);
    } else if (!state.roomData) {
      state.roomData = createEmptyRoomData();
    }
  }

  function saveLocalRoom(code, skipMqttPublish) {
    try {
      const all = getAllLocalRooms();
      state.roomData.meta.updatedAt = Date.now();
      all[code] = state.roomData;
      localStorage.setItem(LS_LOCAL_ROOMS_KEY, JSON.stringify(all));
      if (bc) bc.postMessage({ roomCode: code, t: Date.now() });
      if (!skipMqttPublish) {
        publishMqttRoomState();
      }
    } catch (e) {}
  }

  function initMqttFallback() {
    if (typeof window.mqtt === "undefined") return;
    try {
      mqttClient = window.mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
        clientId: "jm_" + (state.uid || Math.random().toString(36).slice(2, 10)) + "_" + Math.random().toString(36).slice(2, 6),
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 3000
      });
      mqttClient.on("connect", () => {
        mqttConnected = true;
        if (state.joined && state.roomCode) {
          subscribeMqttRoom(state.roomCode);
        }
        renderStatusBar();
      });
      mqttClient.on("close", () => {
        mqttConnected = false;
        renderStatusBar();
      });
      mqttClient.on("offline", () => {
        mqttConnected = false;
        renderStatusBar();
      });
      mqttClient.on("message", (topic, payload) => {
        if (!state.joined || topic !== `jingmei-clarity-2026/rooms/${state.roomCode}`) return;
        try {
          const incoming = JSON.parse(payload.toString());
          if (!incoming || typeof incoming !== "object") return;
          // 合併雲端狀態與本機狀態，確保歷史傳話與仲介筆記絕不被覆蓋刪除
          const merged = mergeRoomData(state.roomData, incoming);
          if (state.joined && state.uid) {
            merged.players[state.uid] = {
              nick: state.nick,
              role: state.role,
              online: true,
              lastSeen: Date.now()
            };
          }
          state.roomData = merged;
          const all = getAllLocalRooms();
          all[state.roomCode] = state.roomData;
          localStorage.setItem(LS_LOCAL_ROOMS_KEY, JSON.stringify(all));
          renderAll();
        } catch (e) {}
      });
    } catch (e) {}
  }

  function subscribeMqttRoom(code) {
    if (!mqttClient || !mqttConnected || !code) return;
    const topic = `jingmei-clarity-2026/rooms/${code}`;
    if (currentMqttTopic && currentMqttTopic !== topic) {
      mqttClient.unsubscribe(currentMqttTopic);
    }
    currentMqttTopic = topic;
    mqttClient.subscribe(topic, { qos: 0 }, () => {
      // 訂閱後稍等 400ms 接收保留訊息並合併，再廣播自己的在線狀態與仲介筆記
      setTimeout(() => {
        if (state.joined && state.roomCode === code) {
          markLocalPlayerOnline(true);
          if (state.role === "sagent" || state.role === "bagent") {
            syncAgentNotesToRoom(state.role, true);
          }
        }
      }, 400);
    });
  }

  function publishMqttRoomState() {
    if (!mqttClient || !mqttConnected || !state.roomCode) return;
    try {
      const topic = `jingmei-clarity-2026/rooms/${state.roomCode}`;
      mqttClient.publish(topic, JSON.stringify(state.roomData), { qos: 0, retain: true });
    } catch (e) {}
  }

  function markLocalPlayerOnline(online, skipMqttPublish) {
    if (!state.roomCode) return;
    loadLocalRoom(state.roomCode);
    if (!state.roomData.players[state.uid]) {
      state.roomData.players[state.uid] = {};
    }
    state.roomData.players[state.uid] = {
      nick: state.nick,
      role: state.role,
      online: online,
      lastSeen: Date.now()
    };
    saveLocalRoom(state.roomCode, skipMqttPublish);
  }

  function updatePlayerPresence() {
    if (!state.joined || !state.roomCode) return;
    if (state.firebaseReady && db) {
      const pRef = db.ref(`rooms/${state.roomCode}/players/${state.uid}`);
      pRef.onDisconnect().update({
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      });
      pRef.set({
        nick: state.nick,
        role: state.role,
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      });
      db.ref(`rooms/${state.roomCode}/meta/updatedAt`).set(firebase.database.ServerValue.TIMESTAMP);
      if (state.role === "sagent" || state.role === "bagent") {
        syncAgentNotesToRoom(state.role, true);
      }
    } else {
      markLocalPlayerOnline(true);
      if (state.role === "sagent" || state.role === "bagent") {
        syncAgentNotesToRoom(state.role, true);
      }
    }
  }

  function joinRoomInternal(code) {
    if (roomRef) {
      roomRef.off();
      roomRef = null;
    }
    state.roomCode = code;
    state.joined = true;
    saveSession();

    if (state.firebaseReady && db) {
      roomRef = db.ref(`rooms/${code}`);
      roomRef.on("value", (snap) => {
        const val = snap.val();
        if (!val) {
          const initData = createEmptyRoomData();
          initData.players[state.uid] = {
            nick: state.nick,
            role: state.role,
            online: true,
            lastSeen: Date.now()
          };
          roomRef.set(initData);
          state.roomData = initData;
        } else {
          state.roomData = mergeRoomData(state.roomData, val);
        }
        renderAll();
      });
      updatePlayerPresence();
    } else {
      loadLocalRoom(code);
      // 先在記憶體與本機標記在線，待 subscribeMqttRoom 收到雲端保留訊息合併後再發布至 MQTT，避免覆蓋既有房間資料
      markLocalPlayerOnline(true, true);
      subscribeMqttRoom(code);
      renderAll();
    }
  }

  function leaveRoomInternal() {
    if (state.firebaseReady && db && state.roomCode) {
      db.ref(`rooms/${state.roomCode}/players/${state.uid}`).update({
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      });
      if (roomRef) {
        roomRef.off();
        roomRef = null;
      }
    } else if (state.roomCode) {
      markLocalPlayerOnline(false);
    }
    state.joined = false;
    saveSession();
    renderAll();
  }

  // 寫入房間部分節點
  function writeRoomPatch(pathAfterRoom, value, skipRender) {
    if (!state.roomCode) {
      // 尚未加入房間時，仍同步更新本機 state.roomData 結構以便立即預覽
      const parts = pathAfterRoom.split("/");
      let cur = state.roomData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
          cur[parts[i]] = {};
        }
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      if (!skipRender) renderAll();
      return;
    }
    if (state.firebaseReady && db && state.joined) {
      db.ref(`rooms/${state.roomCode}/${pathAfterRoom}`).set(value);
      db.ref(`rooms/${state.roomCode}/meta/updatedAt`).set(firebase.database.ServerValue.TIMESTAMP);
    } else {
      // 單機或本機跨分頁模式
      if (state.joined) loadLocalRoom(state.roomCode);
      const parts = pathAfterRoom.split("/");
      let cur = state.roomData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
          cur[parts[i]] = {};
        }
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      if (state.joined) saveLocalRoom(state.roomCode);
      if (!skipRender) renderAll();
    }
  }

  function syncAgentNotesToRoom(agentKey, skipRender) {
    if (state.role !== agentKey && state.joined) return;
    const curAgent = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || createEmptyAgentNode();
    const draft = (state.agentDraft && state.agentDraft[agentKey]) || { offer: "", intel: "" };
    const updatedNode = Object.assign({}, curAgent, {
      by: state.uid || curAgent.by || null,
      byNick: getMyLoginNick() || curAgent.byNick || "",
      draftOffer: String(draft.offer || ""),
      draftIntel: String(draft.intel || ""),
      notes: state.notes[agentKey],
      notesUpdatedAt: Date.now()
    });
    writeRoomPatch(`agents/${agentKey}`, updatedNode, skipRender !== undefined ? skipRender : true);
  }

  function commitAgentMessageHistory(agentKey, rawOffer, rawIntel, isExplicitSend) {
    const cleanOffer = sanitizePrice(rawOffer);
    const cleanIntel = String(rawIntel || "").trim().slice(0, 300);
    const draftObj = state.agentDraft[agentKey] || { offer: "", intel: "", currentDraftId: null };

    // 若輸入框被清空，絕不刪除或覆蓋已經出現過的歷史紀錄與數值
    if (cleanOffer === null && !cleanIntel) {
      draftObj.currentDraftId = null;
      return false;
    }

    const curAgent = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || createEmptyAgentNode();
    const history = Array.isArray(curAgent.history) ? [...curAgent.history] : [];
    const mRound = state.roomData && state.roomData.manager ? Number(state.roomData.manager.round || 0) : 0;
    const roundLabel = ROUND_LABELS[mRound] || "第一輪";
    const senderNick = getMyLoginNick();
    const now = Date.now();

    let targetIdx = -1;
    if (draftObj.currentDraftId) {
      targetIdx = history.findIndex((h) => h && h.id === draftObj.currentDraftId);
    }

    if (targetIdx >= 0) {
      const existing = history[targetIdx];
      history[targetIdx] = {
        id: existing.id,
        round: mRound,
        roundLabel,
        // 只在有輸入新值時更新，若其中一欄空白則保留該筆原本已出現過的內容，絕不刪除
        offer: cleanOffer !== null ? cleanOffer : existing.offer,
        intel: cleanIntel ? cleanIntel : existing.intel,
        byNick: senderNick || existing.byNick || "",
        ts: now
      };
    } else {
      const newId = `msg_${agentKey}_${now}_${Math.random().toString(36).slice(2, 6)}`;
      history.push({
        id: newId,
        round: mRound,
        roundLabel,
        offer: cleanOffer,
        intel: cleanIntel,
        byNick: senderNick,
        ts: now
      });
      draftObj.currentDraftId = isExplicitSend ? null : newId;
    }

    if (isExplicitSend) {
      draftObj.currentDraftId = null;
      draftObj.offer = "";
      draftObj.intel = "";
    }

    let latestOffer = cleanOffer !== null ? cleanOffer : curAgent.offer;
    let latestIntel = cleanIntel ? cleanIntel : curAgent.intel;
    for (let i = history.length - 1; i >= 0; i--) {
      if (latestOffer === null && history[i].offer !== null) latestOffer = history[i].offer;
      if (!latestIntel && history[i].intel) latestIntel = history[i].intel;
    }

    const updatedNode = {
      intel: latestIntel || "",
      offer: latestOffer !== undefined ? latestOffer : null,
      draftOffer: isExplicitSend ? "" : String(draftObj.offer || ""),
      draftIntel: isExplicitSend ? "" : String(draftObj.intel || ""),
      history,
      by: state.uid,
      byNick: senderNick,
      notes: state.notes[agentKey],
      notesUpdatedAt: now
    };

    writeRoomPatch(`agents/${agentKey}`, updatedNode, !isExplicitSend);
    return true;
  }

  function getAgentMessageHistory(agentKey) {
    const ag = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || createEmptyAgentNode();
    return normalizeAgentHistoryList(ag.history, ag.offer, ag.intel, ag.byNick);
  }

  function getSyncedAgentNotes(agentKey) {
    const ag = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || null;
    const synced = ag && ag.notes;
    const local = state.notes && state.notes[agentKey];
    if (state.role === agentKey || !state.joined) {
      return mergeAgentNotesObjects(local, synced) || createDefaultAgentNotes();
    }
    return mergeAgentNotesObjects(synced, local) || createDefaultAgentNotes();
  }

  function getMyLoginNick() {
    if (state.nick && state.nick.trim()) return state.nick.trim();
    const p = state.roomData && state.roomData.players && state.roomData.players[state.uid];
    if (p && p.nick && p.nick.trim()) return p.nick.trim();
    return "未命名學員";
  }

  function syncMyObserverRecord(sourceKey, skipRender) {
    const src = state.notes[sourceKey] || createDefaultObserverNotes();
    const payload = {
      uid: state.uid || "local_user",
      nick: getMyLoginNick(),
      role: sourceKey === "manager" ? "manager" : "observer",
      updatedAt: Date.now(),
      s_checks: Array.isArray(src.s_checks) ? src.s_checks.map(Boolean) : [false, false, false, false, false, false],
      b_checks: Array.isArray(src.b_checks) ? src.b_checks.map(Boolean) : [false, false, false, false, false, false],
      stages: Object.assign({ stage1: "", stage2: "", stage3: "", stage4: "" }, src.stages || {}),
      fb1: String(src.fb1 || ""),
      fb2: String(src.fb2 || ""),
      fb3: String(src.fb3 || "")
    };
    const uidKey = (state.uid || "local_user") + (sourceKey === "manager" ? "_mgr" : "_obs");
    writeRoomPatch(`observers/${uidKey}`, payload, skipRender);
    const boardBox = document.getElementById("synced-observers-board");
    if (boardBox) {
      boardBox.innerHTML = renderSyncedObserversBoardInner();
      bindSubfolderStateEvents();
    }
  }

  // ==================== 計算邏輯（第 7 節） ====================

  // 7.3 快速填的數字
  function calcQuickFill(clientKey, roundIdx) {
    const roleData = clientKey === "seller" ? CONTENT.SELLER : CONTENT.BUYER;
    const startPrice = clientKey === "seller" ? CONTENT.CASE.ask : CONTENT.CASE.offer;
    const row = roleData.ladder[roundIdx + 1]; // [輪次, 沒做到, 做到, 要換的條件]
    const rounds = state.roomData.clients[clientKey].rounds;

    let prev = startPrice;
    if (roundIdx > 0) {
      const prevSaid = rounds[String(roundIdx - 1)] && rounds[String(roundIdx - 1)].price;
      if (prevSaid !== null && prevSaid !== undefined && prevSaid !== "") {
        prev = Number(prevSaid);
      } else {
        const prevDoneStr = roleData.ladder[roundIdx][2];
        prev = Number(String(prevDoneStr).replace(/,/g, ""));
      }
    }

    const rawNotDone = String(row[1]).trim();
    let notDonePrice = prev;
    const decMatch = rawNotDone.match(/再降\s*(\d+)\s*萬/);
    const incMatch = rawNotDone.match(/再加\s*(\d+)\s*萬/);
    if (decMatch) {
      notDonePrice = prev - Number(decMatch[1]);
    } else if (incMatch) {
      notDonePrice = prev + Number(incMatch[1]);
    } else if (rawNotDone === "不動") {
      notDonePrice = prev;
    } else {
      const parsed = Number(rawNotDone.replace(/,/g, ""));
      if (Number.isFinite(parsed)) notDonePrice = parsed;
    }

    const donePrice = Number(String(row[2]).replace(/,/g, ""));
    const condText = String(row[3] || "");

    return {
      notDoneLabel: `仲介沒做到：${formatNum(notDonePrice)}`,
      notDonePrice,
      doneLabel: `仲介做到：${formatNum(donePrice)}`,
      donePrice,
      condLabel: `條件：${condText}`,
      condText
    };
  }

  // 7.1 仲介價格階梯檢查
  function checkAgentLadder(agentKey, customNotes) {
    const isUp = agentKey === "sagent";
    const notes = customNotes || state.notes[agentKey];
    const rows = notes.ladder; // [開口, 中繼, 目標, 底線/上限推估]
    const openVal = sanitizePrice(rows[0].price);
    const midVal = sanitizePrice(rows[1].price);
    const targetVal = sanitizePrice(rows[2].price);
    const askVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.ask) || 2200;
    const offerVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.offer) || 1800;
    const estVal = sanitizePrice(rows[3].price);

    const results = [];

    if (targetVal === null) {
      results.push({
        type: "info",
        tag: "提醒",
        text: "請透過訪談客戶與交換情報，自行推算並在「目標」欄填入預計成交價"
      });
    }

    // 組裝序列 = [開口, 中繼, 目標]（有填才算）
    const seq = [];
    if (openVal !== null) seq.push({ name: "開口", val: openVal });
    if (midVal !== null) seq.push({ name: "中繼", val: midVal });
    if (targetVal !== null) seq.push({ name: "目標", val: targetVal });

    // 方向檢查（雙向智慧判定：無論學員填「引導客戶讓步階梯」或「回報對方出價階梯」，只要單向朝目標價收斂皆為 OK）
    if (seq.length >= 2) {
      let allUp = true;
      let allDown = true;
      for (let i = 1; i < seq.length; i++) {
        if (!(seq[i].val > seq[i - 1].val)) allUp = false;
        if (!(seq[i].val < seq[i - 1].val)) allDown = false;
      }
      if (!allUp && !allDown) {
        results.push({
          type: "err",
          tag: "要改",
          text: "價格階梯方向有誤：請朝你設定的目標價單向收斂（由高往低逐步讓步，或由低往高逐步加價，不可忽高忽低）。"
        });
      } else {
        const modeDesc = isUp
          ? allDown
            ? "引導屋主降價階梯"
            : "回報買方加價階梯"
          : allUp
          ? "引導買方加價階梯"
          : "對買方要價收斂階梯";
        results.push({
          type: "ok",
          tag: "OK",
          text: `方向正確｜${modeDesc}（${seq.map((s) => formatNum(s.val)).join(" → ")} 萬）`
        });
      }
    }

    // 幅度遞減檢查（序列長度 >= 3 時）
    if (seq.length >= 3) {
      const diffs = [];
      for (let i = 1; i < seq.length; i++) {
        diffs.push(Math.abs(seq[i].val - seq[i - 1].val));
      }
      let strictlyDec = true;
      for (let i = 1; i < diffs.length; i++) {
        if (!(diffs[i] < diffs[i - 1])) strictlyDec = false;
      }
      if (!strictlyDec) {
        results.push({
          type: "warn",
          tag: "注意",
          text: `注意：讓步幅度沒有遞減（${diffs.join(" → ")} 萬），越讓越多，對方會覺得還有空間`
        });
      } else {
        results.push({
          type: "ok",
          tag: "OK",
          text: `讓步幅度遞減（${diffs.join(" → ")} 萬）`
        });
      }
    }

    // 開口合理性檢查
    if (openVal !== null) {
      if (openVal < offerVal) {
        results.push({
          type: "warn",
          tag: "注意",
          text: `注意：開口（${formatNum(openVal)} 萬）比買方真實出價（${formatNum(offerVal)} 萬）還低`
        });
      } else if (openVal >= askVal) {
        results.push({
          type: "err",
          tag: "要改",
          text: `要改：開口（${formatNum(openVal)} 萬）已經到屋主開價（${formatNum(askVal)} 萬）以上`
        });
      } else if (isUp) {
        results.push({
          type: "info",
          tag: "提醒",
          text: "提醒：第一輪跟屋主溝通時，記得帶上買方故事與交換條件"
        });
      }
    }

    // 柱子／論述與「要換什麼」完整性檢查（有填數字的列）
    const stepNames = ["開口", "中繼", "目標"];
    const missingPillarOrArg = [];
    const missingCond = [];
    [0, 1, 2].forEach((idx) => {
      const r = rows[idx];
      const hasPrice = sanitizePrice(r.price) !== null;
      if (hasPrice) {
        const hasPillar = Array.isArray(r.pillars) && r.pillars.length > 0;
        const hasArg = String(r.arg || "").trim().length > 0;
        if (!hasPillar && !hasArg) missingPillarOrArg.push(stepNames[idx]);
        if (!String(r.cond || "").trim()) missingCond.push(stepNames[idx]);
      }
    });
    if (missingPillarOrArg.length > 0) {
      results.push({
        type: "warn",
        tag: "注意",
        text: `缺少柱子或論述：${missingPillarOrArg.join("、")}`
      });
    }
    if (missingCond.length > 0) {
      results.push({
        type: "warn",
        tag: "注意",
        text: `缺少「這一步要換什麼」：${missingCond.join("、")}`
      });
    }

    // 底線／上限推估檢查（與仲介自己設定的目標價比對）
    if (estVal !== null && targetVal !== null) {
      if (isUp) {
        if (estVal > targetVal) {
          results.push({
            type: "warn",
            tag: "注意",
            text: `你推估的屋主底線（${formatNum(estVal)} 萬）> 你設定的目標價（${formatNum(targetVal)} 萬），需要先幫屋主解開心理關卡或條件`
          });
        } else {
          results.push({
            type: "ok",
            tag: "OK",
            text: `底線推估 OK（${formatNum(estVal)} 萬）：目標價 ${formatNum(targetVal)} 萬談得成`
          });
        }
      } else {
        if (estVal < targetVal) {
          results.push({
            type: "warn",
            tag: "注意",
            text: `你推估的買方上限（${formatNum(estVal)} 萬）< 你設定的目標價（${formatNum(targetVal)} 萬），需確認自備款與貸款試算`
          });
        } else {
          results.push({
            type: "ok",
            tag: "OK",
            text: `上限推估 OK（${formatNum(estVal)} 萬）：目標價 ${formatNum(targetVal)} 萬談得成`
          });
        }
      }
    }

    return results;
  }

  // 7.2 議價看板資料與狀態
  function getBoardSeries() {
    const useRoom = state.joined || hasAnyRoomClientData();
    const askVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.ask) || 2200;
    const offerVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.offer) || 1800;
    const targetVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.target) || 2000;
    const sRounds = [0, 1, 2].map((i) => {
      if (useRoom) {
        const r = state.roomData.clients.seller.rounds[String(i)];
        return { price: sanitizePrice(r.price), cond: r.cond || "" };
      } else {
        const m = state.notes.manualBoard.seller[i];
        return { price: sanitizePrice(m.price), cond: m.cond || "" };
      }
    });
    const bRounds = [0, 1, 2].map((i) => {
      if (useRoom) {
        const r = state.roomData.clients.buyer.rounds[String(i)];
        return { price: sanitizePrice(r.price), cond: r.cond || "" };
      } else {
        const m = state.notes.manualBoard.buyer[i];
        return { price: sanitizePrice(m.price), cond: m.cond || "" };
      }
    });

    // 起點 (idx=0)
    const sPrices = [askVal];
    const bPrices = [offerVal];
    let lastValidIdx = 0;

    for (let i = 0; i < 3; i++) {
      const sp = sRounds[i].price;
      const bp = bRounds[i].price;
      if (sp !== null || bp !== null) {
        lastValidIdx = i + 1;
      }
      sPrices.push(sp !== null ? sp : sPrices[sPrices.length - 1]);
      bPrices.push(bp !== null ? bp : bPrices[bPrices.length - 1]);
    }

    const sCur = sPrices[lastValidIdx];
    const bCur = bPrices[lastValidIdx];
    const diff = sCur - bCur;

    let statusText = "";
    let statusClass = "alert-info";

    if (lastValidIdx === 0) {
      statusText = `起點：屋主開價 ${formatNum(askVal)} 萬、買方斡旋 ${formatNum(offerVal)} 萬（還差 ${formatNum(askVal - offerVal)} 萬）`;
    } else if (sCur === bCur) {
      if (sCur === targetVal) {
        statusText = `成交！雙方在 ${formatNum(targetVal)} 萬握手`;
        statusClass = "alert-ok";
      } else {
        statusText = `雙方在 ${formatNum(sCur)} 萬收斂（遊戲設定是 ${formatNum(targetVal)}）`;
        statusClass = "alert-warn";
      }
    } else if (sCur < bCur) {
      statusText = `價格交叉了 ${formatNum(Math.abs(diff))} 萬：有一方讓太多，請店長確認`;
      statusClass = "alert-warn";
    } else if (diff <= 40) {
      statusText = `差 ${formatNum(diff)} 萬：進入最後一步，請店長出面（下黑上白）`;
      statusClass = "alert-ok";
    } else {
      const roundLabel = lastValidIdx === 3 ? "最後一步" : `第 ${lastValidIdx} 輪`;
      statusText = `${roundLabel}後還差 ${formatNum(diff)} 萬（屋主 ${formatNum(sCur)}、買方 ${formatNum(bCur)}）`;
      statusClass = "alert-info";
    }

    return {
      useRoom,
      sRounds,
      bRounds,
      sPrices,
      bPrices,
      lastValidIdx,
      statusText,
      statusClass
    };
  }

  function hasAnyRoomClientData() {
    for (const c of ["seller", "buyer"]) {
      for (const r of ["0", "1", "2"]) {
        const node = state.roomData.clients[c].rounds[r];
        if (node && (node.price !== null || node.cond || node.card !== null)) return true;
      }
    }
    return false;
  }

  // ==================== 畫面渲染 ====================

  function captureActiveInputState() {
    const el = document.activeElement;
    const container = document.getElementById("app-view");
    if (!el || !container || !container.contains(el)) return null;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return null;
    return {
      id: el.id || "",
      cls: el.className || "",
      idx: el.getAttribute("data-idx"),
      stage: el.getAttribute("data-stage"),
      fb: el.getAttribute("data-fb"),
      val: el.value,
      selStart: typeof el.selectionStart === "number" ? el.selectionStart : null,
      selEnd: typeof el.selectionEnd === "number" ? el.selectionEnd : null
    };
  }

  function restoreActiveInputState(snap) {
    if (!snap) return;
    const container = document.getElementById("app-view");
    if (!container) return;
    let target = null;
    if (snap.id) {
      target = document.getElementById(snap.id);
    } else {
      const candidates = container.querySelectorAll("input, textarea");
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (
          c.className === snap.cls &&
          c.getAttribute("data-idx") === snap.idx &&
          c.getAttribute("data-stage") === snap.stage &&
          c.getAttribute("data-fb") === snap.fb
        ) {
          target = c;
          break;
        }
      }
    }
    if (target) {
      target.focus();
      try {
        if (snap.selStart !== null && snap.selEnd !== null && typeof target.setSelectionRange === "function") {
          target.setSelectionRange(snap.selStart, snap.selEnd);
        }
      } catch (e) {}
    }
  }

  function renderAll() {
    if (!CONTENT) return;
    if (!canAccessTab(state.tab)) {
      state.tab = canAccessTab(state.role) ? state.role : "room";
      try {
        history.replaceState(null, "", `#${state.tab}`);
      } catch (e) {}
    }
    const focusSnap = captureActiveInputState();
    renderStatusBar();
    renderNavTabs();
    renderActiveTab();
    restoreActiveInputState(focusSnap);
  }

  function renderStatusBar() {
    const connDot = document.getElementById("conn-dot");
    const connText = document.getElementById("conn-text");
    const roomPill = document.getElementById("room-pill");
    const rolePill = document.getElementById("role-pill");
    const onlinePill = document.getElementById("online-pill");
    const roundPill = document.getElementById("round-pill");
    const dealBanner = document.getElementById("deal-banner");

    const isBrowserOnline = navigator.onLine !== false;
    if (!isBrowserOnline) {
      connDot.className = "status-dot offline";
      connText.textContent = "單機模式（網路斷線）";
    } else if (state.firebaseReady && state.firebaseConnected) {
      connDot.className = "status-dot online";
      connText.textContent = "Firebase 即時連線";
    } else if (mqttConnected) {
      connDot.className = "status-dot online";
      connText.textContent = "雲端即時連線";
    } else {
      connDot.className = "status-dot local";
      connText.textContent = "單機模式";
    }

    const scTitle = CONTENT && CONTENT.shortTitle ? CONTENT.shortTitle : "景美三房";
    roomPill.textContent =
      (state.joined && state.roomCode ? `房間：${state.roomCode}` : "房間：未加入") + `｜劇本：${scTitle}`;

    const roleObj = ROLES.find((r) => r.id === state.role);
    const roleName = roleObj ? roleObj.short : "未選擇";
    rolePill.textContent = state.nick ? `${roleName}（${state.nick}）` : `角色：${roleName}`;

    const players = Object.values(state.roomData.players || {});
    const onlineCount = state.joined ? players.filter((p) => p && p.online).length : 0;
    onlinePill.textContent = `在線：${onlineCount} 人`;

    const mRound = state.roomData.manager ? state.roomData.manager.round : 0;
    const roundName = ROUND_LABELS[mRound] || "第一輪";
    roundPill.textContent = isGameStarted() ? `店長輪次：${roundName}` : "狀態：⏳ 等待店長按遊戲開始";

    const dealPrice = state.roomData.manager && state.roomData.manager.deal;
    if (dealPrice !== null && dealPrice !== undefined && dealPrice !== "") {
      dealBanner.className = "deal-banner active";
      dealBanner.textContent = `🎉 店長宣布：${formatNum(dealPrice)} 萬成交！（遊戲結束，已開放全體成員查看所有角色細節與回饋）`;
    } else if (isGameStarted()) {
      dealBanner.className = "deal-banner started";
      dealBanner.textContent = `🔥 遊戲正式開始！買賣方角色卡已開啟（目前進度：${roundName}）`;
    } else {
      dealBanner.className = "deal-banner";
      dealBanner.textContent = "";
    }
  }

  function renderNavTabs() {
    const nav = document.getElementById("nav-tabs");
    nav.innerHTML = TABS.map((t) => {
      const active = state.tab === t.id ? "active" : "";
      const allowed = canAccessTab(t.id);
      const lockedCls = allowed ? "" : "locked";
      const lockIcon = allowed ? "" : `<span class="lock-icon" aria-hidden="true">🔒</span>`;
      const dotHtml = t.dot ? `<span class="role-dot" style="background:${t.dot}"></span>` : "";
      const titleAttr = allowed
        ? ""
        : `title="遊戲進行中僅能查看自己的角色，待店長按下「宣布成交」後開放查看所有角色細節"`;
      return `<a href="#${t.id}" class="nav-tab ${active} ${lockedCls}" data-tab="${t.id}" data-allowed="${allowed ? "1" : "0"}" ${titleAttr}>${dotHtml}${lockIcon}${escapeHtml(t.label)}</a>`;
    }).join("");

    nav.querySelectorAll(".nav-tab").forEach((link) => {
      link.addEventListener("click", (e) => {
        const tabId = link.getAttribute("data-tab");
        if (!canAccessTab(tabId)) {
          e.preventDefault();
          const roleObj = ROLES.find((r) => r.id === state.role);
          const myRoleName = roleObj ? roleObj.short : state.role;
          showLockToast(
            `🔒 遊戲進行中，除「店長」與「觀察者」外，你（${myRoleName}）目前只能查看自己的頁籤；待店長按下「宣布成交」結束遊戲後，即可查看所有人的細節！`
          );
        }
      });
    });
  }

  function renderActiveTab() {
    const container = document.getElementById("app-view");

    // 紀錄目前正在輸入中的欄位焦點與游標，避免遠端同步重繪時打斷輸入
    let activeInputSnapshot = null;
    const activeEl = document.activeElement;
    if (
      activeEl &&
      container.contains(activeEl) &&
      (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA") &&
      activeEl.type !== "checkbox" &&
      activeEl.type !== "radio"
    ) {
      activeInputSnapshot = {
        id: activeEl.id || "",
        className: activeEl.className || "",
        dataIdx: activeEl.getAttribute("data-idx"),
        dataStage: activeEl.getAttribute("data-stage"),
        dataFb: activeEl.getAttribute("data-fb"),
        value: activeEl.value,
        selStart: typeof activeEl.selectionStart === "number" ? activeEl.selectionStart : null,
        selEnd: typeof activeEl.selectionEnd === "number" ? activeEl.selectionEnd : null
      };
    }

    let pageHtml = "";
    switch (state.tab) {
      case "room":
        pageHtml = renderRoomPage();
        break;
      case "rules":
        pageHtml = renderRulesPage();
        break;
      case "case":
        pageHtml = renderCasePage();
        break;
      case "seller":
        pageHtml = renderClientPage("seller");
        break;
      case "buyer":
        pageHtml = renderClientPage("buyer");
        break;
      case "sagent":
        pageHtml = renderAgentPage("sagent");
        break;
      case "bagent":
        pageHtml = renderAgentPage("bagent");
        break;
      case "manager":
        pageHtml = renderManagerPage();
        break;
      case "observer":
        pageHtml = renderObserverPage();
        break;
      case "board":
        pageHtml = renderBoardPage();
        break;
      default:
        pageHtml = renderRoomPage();
    }

    const toastBannerHtml = `<div id="lock-toast-banner" class="alert alert-secret" style="display:${
      lockToastMsg ? "flex" : "none"
    };">${escapeHtml(lockToastMsg)}</div>`;

    container.innerHTML = toastBannerHtml + pageHtml;

    switch (state.tab) {
      case "room":
        bindRoomEvents();
        break;
      case "seller":
        bindClientEvents("seller");
        break;
      case "buyer":
        bindClientEvents("buyer");
        break;
      case "sagent":
        bindAgentEvents("sagent");
        break;
      case "bagent":
        bindAgentEvents("bagent");
        break;
      case "manager":
        bindManagerEvents();
        break;
      case "observer":
        bindObserverEvents();
        break;
      case "board":
        bindBoardEvents();
        break;
    }
    bindSubfolderStateEvents();
    bindGameStartControlEvents();

    if (activeInputSnapshot) {
      let targetEl = null;
      if (activeInputSnapshot.id) {
        targetEl = document.getElementById(activeInputSnapshot.id);
      } else {
        const candidates = container.querySelectorAll("input, textarea");
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          if (
            c.className === activeInputSnapshot.className &&
            c.getAttribute("data-idx") === activeInputSnapshot.dataIdx &&
            c.getAttribute("data-stage") === activeInputSnapshot.dataStage &&
            c.getAttribute("data-fb") === activeInputSnapshot.dataFb
          ) {
            targetEl = c;
            break;
          }
        }
      }
      if (targetEl) {
        if (targetEl.value !== activeInputSnapshot.value && activeInputSnapshot.value !== "") {
          targetEl.value = activeInputSnapshot.value;
        }
        try {
          targetEl.focus({ preventScroll: true });
          if (activeInputSnapshot.selStart !== null && targetEl.setSelectionRange) {
            targetEl.setSelectionRange(activeInputSnapshot.selStart, activeInputSnapshot.selEnd);
          }
        } catch (e) {}
      }
    }
  }

  function bindSubfolderStateEvents() {
    document.querySelectorAll("details.obs-subfolder[data-folder-id]").forEach((det) => {
      const fId = det.getAttribute("data-folder-id");
      det.addEventListener("toggle", () => {
        if (det.open) openSubfolderIds.add(fId);
        else openSubfolderIds.delete(fId);
      });
    });
  }

  function renderGameStartControlCard() {
    const readiness = getRoomRoleReadiness();
    const started = isGameStarted();
    const ended = isGameEnded();
    const isManager = state.role === "manager";

    const roleSlotsHtml = readiness.coreRoles
      .map(
        (r) => `
        <div class="ready-slot ${r.ready ? "ready" : "waiting"}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span class="role-badge ${r.colorClass}">${escapeHtml(r.short)}</span>
            <span style="font-size:0.8rem;font-weight:900;color:${r.ready ? "var(--ok-text)" : "var(--muted)"};">
              ${r.ready ? "✅ 已到位" : "⏳ 等待加入"}
            </span>
          </div>
          <div style="margin-top:6px;font-size:0.86rem;font-weight:700;color:var(--text);">
            ${r.ready ? escapeHtml(r.holders.join("、")) : "尚無人進入"}
          </div>
        </div>`
      )
      .join("");

    let actionAreaHtml = "";
    if (ended) {
      actionAreaHtml = `
        <div class="alert alert-ok" style="margin-bottom:0;">
          <span>🎉 <strong>遊戲已成交結束！</strong>所有角色的秘密字卡、筆記與觀察回饋皆已全面開放查看。</span>
        </div>
      `;
    } else if (started) {
      actionAreaHtml = `
        <div class="alert alert-ok" style="margin-bottom:0;">
          <div>
            <div style="font-size:1.04rem;font-weight:900;">🔥 遊戲正式開始！買賣方角色卡已開啟！</div>
            <div style="font-size:0.88rem;margin-top:2px;">請各角色點選上方導覽列或右側按鈕，進入自己的角色頁籤開啟字卡。</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <a href="#${escapeHtml(state.role)}" class="btn btn-primary btn-sm">👉 前往我的角色頁籤（${escapeHtml(
        getRoleDisplayName(state.role)
      )}）</a>
            ${
              isManager
                ? `<button type="button" class="btn btn-sm btn-reset-start-state">⏸️ 退回準備狀態（重新鎖定買賣方角色卡）</button>`
                : ""
            }
          </div>
        </div>
      `;
    } else {
      // 尚未開始
      if (isManager) {
        actionAreaHtml = `
          <div style="background:${readiness.allReady ? "var(--ok-bg)" : "var(--warn-bg)"};border:1px solid ${
          readiness.allReady ? "#A9DFB8" : "#F5C99B"
        };padding:14px 16px;border-radius:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:900;font-size:1rem;color:${readiness.allReady ? "var(--ok-text)" : "var(--warn-text)"};">
                ${
                  readiness.allReady
                    ? "✅ 5 大遊戲角色皆已進入房間！請店長按下按鈕宣布「遊戲正式開始」"
                    : `⏳ 等待所有遊戲角色進入房間（尚缺：${escapeHtml(readiness.missingRoles.join("、"))}）`
                }
              </div>
              <div style="font-size:0.86rem;color:var(--text);margin-top:3px;">
                店長按下「🚀 遊戲開始」後，屋主與買方的秘密角色卡才會正式解鎖開啟！
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
              <button type="button" class="btn ${readiness.allReady ? "btn-primary" : "btn-dark"} btn-trigger-game-start" ${
          readiness.allReady ? "" : "disabled"
        } style="font-size:1rem;padding:10px 20px;">
                ${
                  readiness.allReady
                    ? "🚀 遊戲正式開始（開啟買賣方角色卡）"
                    : `🔒 待角色到齊後啟動（缺：${escapeHtml(readiness.missingRoles.join("、"))}）`
                }
              </button>
              ${
                !readiness.allReady
                  ? `<button type="button" class="btn btn-sm btn-force-game-start" title="3～4 人少人演練或單機測試時，店長可直接點此啟動遊戲">⚡ 少人演練直接開始</button>`
                  : ""
              }
            </div>
          </div>
        `;
      } else {
        actionAreaHtml = `
          <div class="alert alert-warn" style="margin-bottom:0;">
            <div>
              <div>🔒 <strong>買賣方角色卡目前鎖定中（等待遊戲開始）</strong></div>
              <div style="font-size:0.88rem;font-weight:500;margin-top:2px;">
                ${
                  readiness.allReady
                    ? "✅ 所有遊戲角色皆已進入房間！請等待「店長」按下【🚀 遊戲正式開始】按鈕，買賣方角色卡即可開啟。"
                    : `⏳ 目前尚缺角色：<strong>${escapeHtml(
                        readiness.missingRoles.join("、")
                      )}</strong>。待所有角色進入房間後，由「店長」按下【🚀 遊戲正式開始】即可開啟買賣方角色卡！`
                }
              </div>
            </div>
          </div>
        `;
      }
    }

    return `
      <div class="card" style="border:2px solid ${started ? "var(--ok-text)" : "var(--accent)"};">
        <div class="card-title">
          <span>🎬 遊戲啟動控台（5 大核心角色到位狀態）</span>
          <span style="font-size:0.85rem;font-weight:700;color:${started ? "var(--ok-text)" : "var(--brick)"};">
            ${ended ? "🎉 遊戲已成交結束" : started ? "🔥 遊戲進行中（角色卡已解鎖）" : "⏳ 準備階段（買賣方角色卡鎖定中）"}
          </span>
        </div>
        <div class="ready-slots-grid" style="margin-bottom:14px;">
          ${roleSlotsHtml}
        </div>
        ${actionAreaHtml}
      </div>
    `;
  }

  function bindGameStartControlEvents() {
    const doStart = () => {
      writeRoomPatch("manager/updatedAt", Date.now(), true);
      writeRoomPatch("manager/started", true, true);
      writeRoomPatch("manager/by", state.uid);
    };
    document.querySelectorAll(".btn-trigger-game-start, .btn-force-game-start").forEach((btn) => {
      btn.addEventListener("click", doStart);
    });
    document.querySelectorAll(".btn-reset-start-state").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.revealSellerRole = false;
        state.revealBuyerRole = false;
        writeRoomPatch("manager/updatedAt", Date.now(), true);
        writeRoomPatch("manager/started", false);
      });
    });
  }

  // ==================== 5.1 房間頁 ====================
  function renderRoomPage() {
    const playersMap = state.roomData.players || {};
    const playersList = Object.entries(playersMap).map(([uid, p]) => ({
      uid,
      nick: p.nick || "匿名",
      role: p.role || "seller",
      online: !!p.online
    }));

    // 檢查重複在線角色（觀察者 single: false 不限人數，店長與其他角色限 1 人）
    const duplicateWarnings = [];
    ROLES.forEach((r) => {
      if (r.single === false) return;
      const holders = playersList.filter((p) => p.online && p.role === r.id);
      if (holders.length >= 2) {
        duplicateWarnings.push(
          `${r.short}只能有一位（目前有：${holders.map((h) => h.nick).join("、")}），請其中一位換角色或改選「觀察者」`
        );
      }
    });

    const shareUrl = state.roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.roomCode)}&scenario=${encodeURIComponent(state.scenario)}`
      : `${window.location.origin}${window.location.pathname}?scenario=${encodeURIComponent(state.scenario)}`;

    const scenarioList = ["jingmei", "banqiao", "zhongshan"]
      .map((k) => SCENARIOS[k])
      .filter(Boolean);

    return `
      <div class="page-header">
        <h1>談判小房間｜選擇劇本與進入房間</h1>
        <span class="page-subtitle">免登入・可任選 3 套實戰斡旋劇本・輸入同組代碼即可多人連線同步</span>
      </div>

      ${
        !state.firebaseReady && !mqttConnected
          ? `<div class="alert alert-info">
              <span>📡 目前為<strong>單機模式</strong>（離線中）。所有頁面與計算皆可正常使用；同一台電腦開多個分頁亦可直接測試同步！</span>
            </div>`
          : ""
      }

      ${duplicateWarnings
        .map((w) => `<div class="alert alert-warn">⚠️ ${escapeHtml(w)}</div>`)
        .join("")}

      <div class="card">
        <div class="card-title">
          <span>1. 選擇要玩的遊戲劇本主題（點擊立即切換）</span>
          <span style="font-size:0.84rem;color:var(--muted);">同房間成員會自動同步使用同一個劇本</span>
        </div>
        <div class="scenario-grid">
          ${scenarioList
            .map((sc) => {
              const isSel = state.scenario === sc.id ? "selected" : "";
              const ask = formatNum(sc.CASE.ask);
              const offer = formatNum(sc.CASE.offer);
              const diff = formatNum(sc.CASE.ask - sc.CASE.offer);
              return `
                <button type="button" class="scenario-card ${isSel}" data-scenario="${escapeHtml(sc.id)}">
                  <div class="scenario-badge">${escapeHtml(sc.badge || "實戰劇本")}</div>
                  <div class="scenario-title">${escapeHtml(sc.CASE.title)}</div>
                  <div class="scenario-price">開價 ${ask} 萬 vs 斡旋 ${offer} 萬（價差 ${diff} 萬）</div>
                  <div class="scenario-desc">
                    <div><strong>屋主：</strong>${escapeHtml(sc.SELLER.who)}</div>
                    <div><strong>買方：</strong>${escapeHtml(sc.BUYER.who)}</div>
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-title">2. 輸入組別代碼與你的角色</div>
        <div class="form-grid" style="margin-bottom:14px;">
          <div>
            <label class="field-label" for="inp-room-code">組別代碼（英數 2–12 字，不分大小寫）</label>
            <input type="text" id="inp-room-code" maxlength="12" placeholder="例如：a1" value="${escapeHtml(state.roomCode)}" />
          </div>
          <div>
            <label class="field-label" for="inp-nick">你的暱稱（最多 20 字）</label>
            <input type="text" id="inp-nick" maxlength="20" placeholder="例如：小明" value="${escapeHtml(state.nick)}" />
          </div>
        </div>

        <label class="field-label">選擇你的角色（點擊立即切換）</label>
        <div class="role-grid" style="margin-bottom:16px;">
          ${ROLES.map((r) => {
            const holders = playersList
              .filter((p) => p.online && p.role === r.id)
              .map((p) => p.nick);
            const selected = state.role === r.id ? "selected" : "";
            const dispName = getRoleDisplayName(r.id);
            return `
              <button type="button" class="role-choice-btn ${selected}" data-role="${r.id}">
                <div class="role-choice-top">
                  <span class="role-dot" style="background:${r.color}"></span>
                  <span>${escapeHtml(dispName)}</span>
                </div>
                <div class="role-choice-holders">
                  ${holders.length ? `目前：${escapeHtml(holders.join("、"))}` : "尚無人選擇"}
                </div>
              </button>
            `;
          }).join("")}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <button type="button" id="btn-join-room" class="btn btn-primary">🚪 加入房間</button>
          <button type="button" id="btn-create-room" class="btn btn-dark">✨ 建立新房間（自動產生 4 碼）</button>
          ${
            state.joined
              ? `<button type="button" id="btn-leave-room" class="btn">離開房間</button>`
              : ""
          }
        </div>
        <div id="room-msg" style="margin-top:8px;font-size:0.88rem;color:var(--brick);font-weight:700;"></div>
      </div>

      ${renderGameStartControlCard()}

      <div class="card">
        <div class="card-title">
          <span>3. 房間成員清單（${state.joined && state.roomCode ? `代碼：${escapeHtml(state.roomCode)}` : "尚未加入"}）</span>
          <span style="font-size:0.85rem;color:var(--muted);">5 人一組・4 人時講師兼店長・3 人時一人兼兩邊仲介</span>
        </div>
        ${
          playersList.length === 0
            ? `<div style="color:var(--muted);font-size:0.92rem;">目前房間尚無成員紀錄，請輸入代碼與暱稱後按「加入房間」。</div>`
            : `<table class="resp-table">
                <thead>
                  <tr>
                    <th>角色</th>
                    <th>暱稱</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  ${playersList
                    .map((p) => {
                      const rObj = ROLES.find((r) => r.id === p.role) || ROLES[0];
                      return `
                        <tr>
                          <td data-label="角色"><span class="role-badge ${rObj.colorClass}">${escapeHtml(getRoleDisplayName(rObj.id))}</span></td>
                          <td data-label="暱稱"><strong>${escapeHtml(p.nick)}</strong> ${p.uid === state.uid ? "（你）" : ""}</td>
                          <td data-label="狀態">
                            <span class="status-dot ${p.online ? "online" : "offline"}" style="margin-right:5px;"></span>
                            ${p.online ? "在線" : "離線"}
                          </td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>`
        }
      </div>

      <div class="card">
        <div class="card-title">4. 分享房間連結與 QR Code</div>
        <div class="share-box">
          <div class="qr-wrap" id="qr-container" aria-label="房間連結 QR Code"></div>
          <div style="flex:1;min-width:220px;">
            <div class="field-label">同組邀請連結（打開自動帶入組別代碼與劇本）</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <input type="text" id="inp-share-url" readonly value="${escapeHtml(shareUrl)}" style="flex:1;min-width:200px;background:#FFF;" />
              <button type="button" id="btn-copy-link" class="btn btn-primary">複製連結</button>
            </div>
            <div style="font-size:0.84rem;color:var(--muted);">
              請勿在遊戲欄位填寫真實客戶個資；房間資料僅供課堂演練同步使用。
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindRoomEvents() {
    const inpCode = document.getElementById("inp-room-code");
    const inpNick = document.getElementById("inp-nick");
    const msgEl = document.getElementById("room-msg");

    document.querySelectorAll(".scenario-card").forEach((card) => {
      card.addEventListener("click", () => {
        const scId = card.getAttribute("data-scenario");
        setScenario(scId, true);
      });
    });

    document.querySelectorAll(".role-choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.role = btn.getAttribute("data-role");
        saveSession();
        if (state.joined && state.roomCode) {
          updatePlayerPresence();
        }
        renderAll();
      });
    });

    const doJoin = (codeRaw) => {
      const code = normalizeRoomCode(codeRaw);
      const nick = String(inpNick.value || "").trim().slice(0, 20) || "學員";
      if (code.length < 2 || code.length > 12) {
        msgEl.textContent = "請輸入 2–12 碼英數組別代碼（例如：a1）";
        return;
      }
      state.roomCode = code;
      state.nick = nick;
      msgEl.textContent = "";
      joinRoomInternal(code);
    };

    document.getElementById("btn-join-room").addEventListener("click", () => {
      doJoin(inpCode.value);
    });

    document.getElementById("btn-create-room").addEventListener("click", () => {
      const chars = "abcdefghjkmnpqrstuvwxyz23456789";
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      inpCode.value = code;
      doJoin(code);
    });

    const btnLeave = document.getElementById("btn-leave-room");
    if (btnLeave) {
      btnLeave.addEventListener("click", () => {
        leaveRoomInternal();
      });
    }

    const btnCopyLink = document.getElementById("btn-copy-link");
    if (btnCopyLink) {
      btnCopyLink.addEventListener("click", () => {
        const shareUrl = document.getElementById("inp-share-url").value;
        navigator.clipboard.writeText(shareUrl).then(() => {
          btnCopyLink.textContent = "✅ 已複製連結";
          setTimeout(() => (btnCopyLink.textContent = "複製連結"), 1800);
        });
      });
    }

    // 繪製 QR Code
    const qrBox = document.getElementById("qr-container");
    const shareUrl = document.getElementById("inp-share-url").value;
    if (qrBox && shareUrl) {
      if (typeof window.qrcode === "function") {
        try {
          const qr = window.qrcode(0, "M");
          qr.addData(shareUrl);
          qr.make();
          qrBox.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 1 });
        } catch (e) {
          qrBox.textContent = "QR Code";
        }
      } else {
        qrBox.textContent = "QR Code";
      }
    }
  }

  // ==================== 5.2 說明與情境（公開頁） ====================
  function renderRulesPage() {
    const R = CONTENT.RULES;
    return `
      <div class="page-header">
        <h1>遊戲說明｜${escapeHtml(CONTENT.CASE.title)}</h1>
        <span class="page-subtitle">第四堂 PART 5 完整演練（約 60 分鐘）</span>
      </div>

      <div class="card">
        <div class="card-title">🎯 遊戲目標</div>
        <p style="margin:0;font-weight:700;font-size:1.02rem;">${escapeHtml(R.goal)}</p>
      </div>

      <div class="card">
        <div class="card-title">👥 角色與分卡</div>
        <table class="resp-table">
          <thead>
            <tr>
              <th>角色</th>
              <th>拿到什麼卡</th>
              <th>主要任務</th>
            </tr>
          </thead>
          <tbody>
            ${R.roles
              .map(
                (row) => `
              <tr>
                <td data-label="角色"><strong>${escapeHtml(row[0])}</strong></td>
                <td data-label="拿到什麼卡">${escapeHtml(row[1])}</td>
                <td data-label="主要任務">${escapeHtml(row[2])}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
        <div style="margin-top:10px;font-size:0.9rem;color:var(--muted);">💡 人數調整：${escapeHtml(R.fewer)}</div>
      </div>

      <div class="card">
        <div class="card-title">⏱️ 演練流程（約 60 分鐘）</div>
        <table class="resp-table">
          <thead>
            <tr>
              <th>階段</th>
              <th>時間</th>
              <th>做什麼</th>
            </tr>
          </thead>
          <tbody>
            ${R.flow
              .map(
                (row) => `
              <tr>
                <td data-label="階段"><strong>${escapeHtml(row[0])}</strong></td>
                <td data-label="時間"><span class="num">${escapeHtml(row[1])}</span></td>
                <td data-label="做什麼">${escapeHtml(row[2])}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">🔄 每一輪怎麼走</div>
        <ol style="margin:0;padding-left:20px;">
          ${R.round.map((step) => `<li style="margin-bottom:6px;font-weight:500;">${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>

      <div class="card">
        <div class="card-title">📏 遊戲規則</div>
        <ul style="margin:0;padding-left:20px;">
          ${R.rules.map((rule) => `<li style="margin-bottom:6px;">${escapeHtml(rule)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  function renderCasePage() {
    const C = CONTENT.CASE;
    return `
      <div class="page-header">
        <h1>公開情境卡｜${escapeHtml(C.title)}</h1>
        <span class="page-subtitle">所有人皆可閱讀的公開案件資訊與實價行情</span>
      </div>

      <div class="card">
        <div class="card-title">📊 斡旋現況</div>
        <div class="status-grid">
          ${C.status
            .filter((s) => !String(s[0]).includes("成交價"))
            .map(
              (s) => `
            <div class="stat-box">
              <div class="stat-label">${escapeHtml(s[0])}</div>
              <div class="stat-val">${escapeHtml(s[1])}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-title">🏢 物件基本資料</div>
        <ul style="margin:0;padding-left:20px;">
          ${C.property.map((p) => `<li style="margin-bottom:6px;font-weight:500;">${escapeHtml(p)}</li>`).join("")}
        </ul>
      </div>

      <div class="form-grid" style="margin-bottom:18px;">
        <div class="card" style="margin-bottom:0;">
          <div class="card-title"><span class="role-badge role-seller">屋主背景（公開）</span></div>
          <p style="margin:0;">${escapeHtml(C.seller_bg)}</p>
        </div>
        <div class="card" style="margin-bottom:0;">
          <div class="card-title"><span class="role-badge role-buyer">買方背景（公開）</span></div>
          <p style="margin:0;">${escapeHtml(C.buyer_bg)}</p>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📈 周邊行情參考表</div>
        <table class="resp-table">
          <thead>
            <tr>
              <th>物件</th>
              <th>格局</th>
              <th>成交／開價</th>
              <th>價格</th>
              <th>備註</th>
            </tr>
          </thead>
          <tbody>
            ${C.market
              .map(
                (m) => `
              <tr>
                <td data-label="物件"><strong>${escapeHtml(m[0])}</strong></td>
                <td data-label="格局">${escapeHtml(m[1])}</td>
                <td data-label="成交／開價">${escapeHtml(m[2])}</td>
                <td data-label="價格"><strong class="num" style="color:var(--brick);">${escapeHtml(m[3])}</strong></td>
                <td data-label="備註">${escapeHtml(m[4])}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==================== 5.3 屋主／買方（秘密頁） ====================
  function renderClientPage(clientKey) {
    const isSeller = clientKey === "seller";
    const C = isSeller ? CONTENT.SELLER : CONTENT.BUYER;
    const reacts = isSeller ? CONTENT.SELLER_REACT : CONTENT.BUYER_REACT;
    const roleLabel = isSeller ? "屋主" : "買方";
    const canPeekAll = state.role === "manager" || state.role === "observer" || isGameEnded();
    const gameStarted = isGameStarted();
    const canOpenRoleCard = gameStarted || canPeekAll;
    const rawReveal = isSeller ? state.revealSellerRole : state.revealBuyerRole;
    const revealed = !canOpenRoleCard ? false : canPeekAll ? rawReveal !== "force_hide" : !!rawReveal;
    const readiness = getRoomRoleReadiness();
    const curRound = state.clientRoundView[clientKey] || 0;
    const managerRound = state.roomData.manager ? Number(state.roomData.manager.round || 0) : 0;

    const cNode = state.roomData.clients[clientKey];
    const rData = cNode.rounds[String(curRound)] || { price: null, cond: "", card: null };
    const deck = cNode.deck || { left: [0, 1, 2, 3, 4, 5, 6, 7], drawn: [] };

    const qf = calcQuickFill(clientKey, curRound);

    // 決定目前顯示哪一張反應卡（本輪抽到的卡，或點擊已抽過歷史看的卡）
    const activeCardIdx =
      state.previewCardIdx[clientKey] !== null && state.previewCardIdx[clientKey] !== undefined
        ? state.previewCardIdx[clientKey]
        : rData.card;

    const cardItem =
      activeCardIdx !== null && activeCardIdx !== undefined && reacts[activeCardIdx]
        ? reacts[activeCardIdx]
        : null;

    let wrongRoleWarning = "";
    if (state.role !== clientKey) {
      if (isGameEnded()) {
        wrongRoleWarning = `<div class="alert alert-ok">
          <span>🎉 <strong>店長已宣布成交（遊戲結束）！</strong>目前已開放全體成員查看${roleLabel}的秘密角色卡與各輪細節。</span>
        </div>`;
      } else if (state.role === "manager" || state.role === "observer") {
        const viewerTitle = state.role === "manager" ? "店長" : "觀察者";
        wrongRoleWarning = `<div class="alert alert-info">
          <span>👁️ 你目前以「<strong>${viewerTitle}（${escapeHtml(getMyLoginNick())}）</strong>」全場視角檢視${roleLabel}的秘密角色卡與各輪細節。</span>
        </div>`;
      } else {
        wrongRoleWarning = `<div class="alert alert-secret">
          <span>🔒 這一頁是${roleLabel}的秘密，請不要偷看（你目前的角色是：${escapeHtml(
            (ROLES.find((r) => r.id === state.role) || {}).name || ""
          )}）</span>
        </div>`;
      }
    }

    const roundDiffBanner =
      managerRound !== curRound
        ? `<div class="alert alert-warn">
            <span>🔔 店長說現在是${ROUND_LABELS[managerRound]}</span>
            <button type="button" class="btn btn-sm btn-dark" id="btn-follow-manager-round">跟上</button>
          </div>`
        : "";

    return `
      <div class="page-header">
        <h1><span class="role-badge ${isSeller ? "role-seller" : "role-buyer"}">${roleLabel}秘密頁</span> ${escapeHtml(C.who)}</h1>
        ${
          canOpenRoleCard
            ? `<button type="button" id="btn-toggle-role-card" class="btn ${revealed ? "btn-dark" : "btn-primary"}">
                ${revealed ? "🙈 蓋上角色卡" : "🃏 翻開角色卡"}
              </button>`
            : `<button type="button" id="btn-toggle-role-card" class="btn" disabled style="opacity:0.65;cursor:not-allowed;">
                🔒 等待店長按「遊戲開始」後開啟
              </button>`
        }
      </div>

      ${wrongRoleWarning}
      ${
        !gameStarted && !isGameEnded()
          ? `<div class="alert alert-warn">
              <span>⏳ <strong>等待遊戲正式開始：</strong>當所有遊戲角色都進入房間後（目前到齊 <strong>${readiness.readyCount}／${readiness.totalRequired}</strong>），由<strong>店長按下「🚀 遊戲正式開始」按鈕</strong>，買賣方角色卡才會解鎖開啟！</span>
              <a href="#room" class="btn btn-sm btn-dark">前往「房間」查看進度</a>
            </div>`
          : ""
      }
      ${roundDiffBanner}

      <!-- 角色秘密卡（預設蓋著，且須等店長按下遊戲開始才可開啟） -->
      <div class="card">
        <div class="card-title">
          <span>🔒 ${roleLabel}角色卡（秘密設定）</span>
          <span style="font-size:0.84rem;color:var(--muted);">
            ${canOpenRoleCard ? "切換分頁會自動蓋回，防旁人誤看" : "⏳ 尚未開局鎖定中（等待店長按下遊戲開始）"}
          </span>
        </div>
        ${
          !canOpenRoleCard
            ? `<div style="text-align:center;padding:28px 16px;background:var(--warn-bg);border:1.5px dashed var(--warn-border);border-radius:10px;">
                <div style="font-size:1.05rem;font-weight:900;margin-bottom:8px;color:var(--warn-text);">
                  🔒 買賣方角色卡尚未解鎖（等待店長按下「🚀 遊戲正式開始」）
                </div>
                <div style="font-size:0.9rem;color:var(--ink);margin-bottom:14px;">
                  目前房間角色到齊進度：<strong>${readiness.readyCount} ／ ${readiness.totalRequired}</strong>
                  ${
                    readiness.missingRoles.length > 0
                      ? `（尚待進入：${escapeHtml(readiness.missingRoles.map((r) => r.short).join("、"))}）`
                      : "（全員已到齊！請提醒店長按下「🚀 遊戲正式開始」）"
                  }
                </div>
                <button type="button" id="btn-toggle-role-card-inner" class="btn" disabled style="opacity:0.65;cursor:not-allowed;">
                  🔒 等待店長按「遊戲開始」後才能翻開角色卡
                </button>
              </div>`
            : !revealed
            ? `<div style="text-align:center;padding:24px 12px;background:var(--light-bg);border-radius:8px;">
                <div style="font-weight:900;margin-bottom:10px;color:var(--ok-text);">✅ 店長已宣布遊戲正式開始！你可以翻開角色卡查看秘密底牌</div>
                <button type="button" id="btn-toggle-role-card-inner" class="btn btn-primary">🃏 翻開角色卡</button>
              </div>`
            : `
              <div class="alert alert-ok" style="margin-bottom:14px;">
                <span>🎯 <strong>你的秘密目標價：${formatNum(CONTENT.CASE.target)} 萬</strong>（請勿直接告訴仲介！請依下方「關鍵數字」與「讓步規則表」，看仲介有沒有問對問題、換到條件，再逐輪給出數字）</span>
              </div>

              <div style="margin-bottom:14px;">
                <strong>你是誰：</strong>${escapeHtml(C.who)}<br/>
                <span>${escapeHtml(C.bio)}</span>
              </div>

              <div class="form-grid" style="margin-bottom:14px;">
                <div class="stat-box" style="text-align:left;">
                  <div class="stat-label">Must（非要不可）</div>
                  <div style="font-weight:700;margin-top:4px;">${escapeHtml(C.must)}</div>
                </div>
                <div class="stat-box" style="text-align:left;">
                  <div class="stat-label">Want（想要）</div>
                  <div style="font-weight:700;margin-top:4px;">${escapeHtml(C.want)}</div>
                </div>
                <div class="stat-box" style="text-align:left;">
                  <div class="stat-label">Give（可以給的條件）</div>
                  <div style="font-weight:700;margin-top:4px;">${escapeHtml(C.give)}</div>
                </div>
                <div class="stat-box" style="text-align:left;">
                  <div class="stat-label">誰拍板（Key Man）</div>
                  <div style="font-weight:700;margin-top:4px;">${escapeHtml(C.key)}</div>
                </div>
              </div>

              <h3 style="font-size:1rem;margin:14px 0 8px;">關鍵數字（注意「什麼時候說」）</h3>
              <table class="resp-table" style="margin-bottom:16px;">
                <thead>
                  <tr>
                    <th>數字</th>
                    <th>是什麼</th>
                    <th>什麼時候說</th>
                  </tr>
                </thead>
                <tbody>
                  ${C.numbers
                    .map((n) => {
                      const isNever = String(n[2]).includes("絕對不說");
                      return `
                        <tr>
                          <td data-label="數字"><strong class="num ${isNever ? "never-say" : ""}">${escapeHtml(n[0])}</strong></td>
                          <td data-label="是什麼">${escapeHtml(n[1])}</td>
                          <td data-label="什麼時候說" class="${isNever ? "never-say" : ""}">${escapeHtml(n[2])}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>

              <h3 style="font-size:1rem;margin:14px 0 8px;">讓步規則表</h3>
              <table class="resp-table" style="margin-bottom:14px;">
                <thead>
                  <tr>
                    <th>輪次</th>
                    <th>仲介沒做到</th>
                    <th>仲介做到</th>
                    <th>你要換的條件</th>
                  </tr>
                </thead>
                <tbody>
                  ${C.ladder
                    .map(
                      (l) => `
                    <tr>
                      <td data-label="輪次"><strong>${escapeHtml(l[0])}</strong></td>
                      <td data-label="仲介沒做到">${escapeHtml(l[1])}</td>
                      <td data-label="仲介做到"><strong>${escapeHtml(l[2])}</strong></td>
                      <td data-label="你要換的條件">${escapeHtml(l[3])}</td>
                    </tr>`
                    )
                    .join("")}
                </tbody>
              </table>

              <div class="alert alert-info" style="margin-bottom:0;">
                <span>🎭 <strong>演出任務：</strong>${escapeHtml(C.act)}</span>
              </div>
            `
        }
      </div>

      <!-- 這一輪你的回應 -->
      <div class="card">
        <div class="card-title">
          <span>📣 這一輪你的回應（即時同步給仲介與店長）</span>
          <div class="round-tabs">
            ${ROUND_LABELS.map(
              (lbl, idx) => `
              <button type="button" class="round-btn ${curRound === idx ? "active" : ""}" data-round="${idx}">
                ${escapeHtml(lbl)}
              </button>`
            ).join("")}
          </div>
        </div>

        <!-- 抽反應卡區 -->
        <div style="background:var(--light-bg);padding:14px;border-radius:10px;margin-bottom:16px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;">
            <div>
              <strong>🎴 ${roleLabel}反應卡</strong>
              <span style="margin-left:8px;font-size:0.88rem;color:var(--muted);">
                剩 <strong>${deck.left.length}</strong> 張 ／ 共 8 張
              </span>
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" id="btn-draw-card" class="btn btn-primary btn-sm">🎲 抽一張</button>
              <button type="button" id="btn-reset-deck" class="btn btn-sm">🔄 洗牌重來</button>
            </div>
          </div>

          <div id="deck-msg" style="color:var(--brick);font-weight:700;font-size:0.88rem;margin-top:6px;"></div>

          ${
            deck.drawn.length > 0
              ? `<div style="margin-top:8px;font-size:0.84rem;color:var(--muted);">
                  已抽過的卡（可點回去看）：
                  <div class="drawn-chips">
                    ${deck.drawn
                      .map((cIdx) => {
                        const numStr = String(cIdx + 1).padStart(2, "0");
                        const isShowing = activeCardIdx === cIdx;
                        return `<button type="button" class="drawn-chip ${isShowing ? "active" : ""}" data-card-idx="${cIdx}">${roleLabel}反應卡 ${numStr}</button>`;
                      })
                      .join("")}
                  </div>
                </div>`
              : ""
          }

          ${
            cardItem
              ? `<div class="react-card ${isSeller ? "seller-theme" : "buyer-theme"}">
                  <span class="react-tag">${roleLabel}反應卡 ${String(activeCardIdx + 1).padStart(2, "0")}</span>
                  <div class="react-quote">${escapeHtml(cardItem[0])}</div>
                  <div class="react-detail-grid">
                    <div class="react-detail-item">
                      <strong>🎭 怎麼演</strong>
                      <span>${escapeHtml(cardItem[1])}</span>
                    </div>
                    <div class="react-detail-item">
                      <strong>🔑 仲介要做到什麼</strong>
                      <span>${escapeHtml(cardItem[2])}</span>
                    </div>
                    <div class="react-detail-item">
                      <strong>✅ 仲介做到 → 你就……</strong>
                      <span style="color:var(--ok-text);font-weight:700;">${escapeHtml(cardItem[3])}</span>
                    </div>
                    <div class="react-detail-item">
                      <strong>❌ 沒做到 → ……</strong>
                      <span style="color:var(--brick);font-weight:700;">${escapeHtml(cardItem[4])}</span>
                    </div>
                  </div>
                </div>`
              : `<div style="margin-top:12px;color:var(--muted);font-size:0.9rem;">本輪尚未抽反應卡，請按上方「抽一張」。</div>`
          }
        </div>

        <!-- 數字與條件輸入 + 快速填按鈕 -->
        <div style="margin-bottom:10px;">
          <span class="field-label">⚡ 快速填入（${ROUND_LABELS[curRound]}）</span>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button type="button" class="btn btn-sm" id="btn-qf-notdone">${escapeHtml(qf.notDoneLabel)}</button>
            <button type="button" class="btn btn-sm btn-primary" id="btn-qf-done">${escapeHtml(qf.doneLabel)}</button>
            <button type="button" class="btn btn-sm" id="btn-qf-cond">${escapeHtml(qf.condLabel)}</button>
          </div>
        </div>

        <div class="form-grid">
          <div>
            <label class="field-label" for="inp-client-price">這一輪你說的數字（萬）</label>
            <input type="number" id="inp-client-price" min="0" max="5000" step="10" placeholder="例如：${qf.donePrice}" value="${rData.price !== null && rData.price !== undefined ? escapeHtml(rData.price) : ""}" />
          </div>
          <div>
            <label class="field-label" for="inp-client-cond">你要換的條件（最多 80 字）</label>
            <input type="text" id="inp-client-cond" maxlength="80" placeholder="${escapeHtml(qf.condText)}" value="${escapeHtml(rData.cond || "")}" />
          </div>
        </div>
      </div>
    `;
  }

  function bindClientEvents(clientKey) {
    const isSeller = clientKey === "seller";
    const canPeekAll = state.role === "manager" || state.role === "observer" || isGameEnded();
    const canOpenRoleCard = isGameStarted() || canPeekAll;
    const toggleCard = () => {
      if (!canOpenRoleCard) {
        showLockToast("🔒 請等待所有遊戲角色進入房間，並由「店長」按下「🚀 遊戲正式開始」後，買賣方角色卡才會解鎖開啟！");
        return;
      }
      if (canPeekAll) {
        if (isSeller) state.revealSellerRole = state.revealSellerRole === "force_hide" ? true : "force_hide";
        else state.revealBuyerRole = state.revealBuyerRole === "force_hide" ? true : "force_hide";
      } else {
        if (isSeller) state.revealSellerRole = !state.revealSellerRole;
        else state.revealBuyerRole = !state.revealBuyerRole;
      }
      renderAll();
    };

    const btnToggle = document.getElementById("btn-toggle-role-card");
    if (btnToggle) btnToggle.addEventListener("click", toggleCard);
    const btnToggleInner = document.getElementById("btn-toggle-role-card-inner");
    if (btnToggleInner) btnToggleInner.addEventListener("click", toggleCard);

    const btnFollow = document.getElementById("btn-follow-manager-round");
    if (btnFollow) {
      btnFollow.addEventListener("click", () => {
        const mRound = state.roomData.manager ? Number(state.roomData.manager.round || 0) : 0;
        state.clientRoundView[clientKey] = mRound;
        state.previewCardIdx[clientKey] = null;
        renderAll();
      });
    }

    document.querySelectorAll(".round-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.clientRoundView[clientKey] = Number(b.getAttribute("data-round"));
        state.previewCardIdx[clientKey] = null;
        renderAll();
      });
    });

    const curRound = state.clientRoundView[clientKey] || 0;
    const cNode = state.roomData.clients[clientKey];

    // 抽一張反應卡（不放回）
    const btnDraw = document.getElementById("btn-draw-card");
    if (btnDraw) {
      btnDraw.addEventListener("click", () => {
        const left = Array.isArray(cNode.deck.left) ? [...cNode.deck.left] : [];
        const drawn = Array.isArray(cNode.deck.drawn) ? [...cNode.deck.drawn] : [];
        const msgEl = document.getElementById("deck-msg");
        if (left.length === 0) {
          if (msgEl) msgEl.textContent = "⚠️ 8 張反應卡已經抽完，請按「洗牌重來」！";
          return;
        }
        const randPos = Math.floor(Math.random() * left.length);
        const picked = left.splice(randPos, 1)[0];
        drawn.push(picked);
        state.previewCardIdx[clientKey] = null;

        writeRoomPatch(`clients/${clientKey}/deck`, { left, drawn });
        writeRoomPatch(`clients/${clientKey}/rounds/${curRound}/card`, picked);
        writeRoomPatch(`clients/${clientKey}/by`, state.uid);
      });
    }

    // 洗牌重來
    const btnResetDeck = document.getElementById("btn-reset-deck");
    if (btnResetDeck) {
      btnResetDeck.addEventListener("click", () => {
        state.previewCardIdx[clientKey] = null;
        writeRoomPatch(`clients/${clientKey}/deck`, {
          left: [0, 1, 2, 3, 4, 5, 6, 7],
          drawn: []
        });
      });
    }

    // 點擊已抽過的卡查看
    document.querySelectorAll(".drawn-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const idx = Number(chip.getAttribute("data-card-idx"));
        state.previewCardIdx[clientKey] = idx;
        renderAll();
      });
    });

    // 快速填按鈕
    const qf = calcQuickFill(clientKey, curRound);
    const inpPrice = document.getElementById("inp-client-price");
    const inpCond = document.getElementById("inp-client-cond");

    const syncRoundFields = (newPrice, newCond) => {
      writeRoomPatch(`clients/${clientKey}/rounds/${curRound}/price`, sanitizePrice(newPrice));
      writeRoomPatch(`clients/${clientKey}/rounds/${curRound}/cond`, String(newCond || "").slice(0, 80));
      writeRoomPatch(`clients/${clientKey}/by`, state.uid);
    };

    document.getElementById("btn-qf-notdone").addEventListener("click", () => {
      inpPrice.value = qf.notDonePrice;
      syncRoundFields(qf.notDonePrice, inpCond.value);
    });
    document.getElementById("btn-qf-done").addEventListener("click", () => {
      inpPrice.value = qf.donePrice;
      syncRoundFields(qf.donePrice, inpCond.value);
    });
    document.getElementById("btn-qf-cond").addEventListener("click", () => {
      inpCond.value = qf.condText;
      syncRoundFields(inpPrice.value, qf.condText);
    });

    inpPrice.addEventListener("change", () => {
      syncRoundFields(inpPrice.value, inpCond.value);
    });
    inpCond.addEventListener("change", () => {
      syncRoundFields(inpPrice.value, inpCond.value);
    });
  }

  // ==================== 5.4 賣方仲介／買方仲介 ====================
  function formatShortTime(ts) {
    if (!ts || ts <= 1000) return "";
    try {
      const d = new Date(Number(ts));
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    } catch (e) {
      return "";
    }
  }

  function renderAgentMessageLogHtml(agentKey, agentLabel) {
    const ag = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || createEmptyAgentNode();
    const history = getAgentMessageHistory(agentKey);
    const draftOffer = ag.draftOffer ? String(ag.draftOffer).trim() : "";
    const draftIntel = ag.draftIntel ? String(ag.draftIntel).trim() : "";

    let latestOffer = ag.offer !== null && ag.offer !== undefined ? ag.offer : null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].offer !== null && history[i].offer !== undefined) {
        latestOffer = history[i].offer;
        break;
      }
    }

    const lastItem = history.length > 0 ? history[history.length - 1] : null;
    const hasUnsentDraft =
      (draftOffer !== "" || draftIntel !== "") &&
      (!lastItem ||
        (draftOffer !== "" && String(lastItem.offer ?? "") !== draftOffer) ||
        (draftIntel !== "" && String(lastItem.intel || "") !== draftIntel));

    if (history.length === 0 && !hasUnsentDraft) {
      return `
        <div style="font-size:1.05rem;font-weight:900;color:var(--brick);margin-bottom:4px;">
          帶過來的數字：尚未傳送
        </div>
        <div style="white-space:pre-wrap;font-size:0.93rem;color:var(--muted);">
          （尚未傳話）
        </div>
      `;
    }

    const latestHeadlineOffer =
      latestOffer !== null && latestOffer !== undefined
        ? `${formatNum(latestOffer)} 萬`
        : hasUnsentDraft && draftOffer
        ? `${escapeHtml(draftOffer)} 萬（輸入中）`
        : "（僅傳話未填數字）";

    return `
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;">
        <div style="font-size:1.05rem;font-weight:900;color:var(--brick);">
          帶過來的數字：${latestHeadlineOffer}
        </div>
        <span style="font-size:0.76rem;background:#EFE8DC;color:var(--dark-band);padding:2px 8px;border-radius:999px;font-weight:700;">
          歷史紀錄共 ${history.length} 筆（遊戲中不刪除）
        </span>
      </div>
      <div class="agent-msg-history-list">
        ${history
          .map((item, idx) => {
            const isLatest = idx === history.length - 1 && !hasUnsentDraft;
            const timeStr = formatShortTime(item.ts);
            return `
              <div class="agent-msg-item ${isLatest ? "latest" : ""}">
                <div class="agent-msg-head">
                  <span class="agent-msg-badge">#${idx + 1}｜${escapeHtml(item.roundLabel || "第一輪")}</span>
                  ${
                    item.byNick
                      ? `<span style="font-size:0.78rem;font-weight:700;color:var(--text);">👤 ${escapeHtml(item.byNick)}</span>`
                      : `<span style="font-size:0.78rem;color:var(--muted);">${escapeHtml(agentLabel || "")}</span>`
                  }
                  ${isLatest ? `<span class="agent-msg-latest-tag">最新</span>` : ""}
                  ${timeStr ? `<span style="font-size:0.75rem;color:var(--muted);margin-left:auto;">${escapeHtml(timeStr)}</span>` : ""}
                </div>
                <div class="agent-msg-offer">
                  帶過來的數字：<strong class="num" style="color:var(--brick);">${
                    item.offer !== null && item.offer !== undefined ? formatNum(item.offer) + " 萬" : "（未填數字）"
                  }</strong>
                </div>
                <div class="agent-msg-text">${item.intel ? escapeHtml(item.intel) : "（未附文字說明）"}</div>
              </div>
            `;
          })
          .join("")}
        ${
          hasUnsentDraft
            ? `
              <div class="agent-msg-item draft">
                <div class="agent-msg-head">
                  <span class="agent-msg-badge draft">✍️ ${escapeHtml(agentLabel || "仲介")}正在輸入中（即時同步）</span>
                </div>
                <div class="agent-msg-offer">
                  帶過來的數字：<strong class="num" style="color:var(--brick);">${
                    draftOffer ? escapeHtml(draftOffer) + " 萬" : "（尚未填數字）"
                  }</strong>
                </div>
                <div class="agent-msg-text">${draftIntel ? escapeHtml(draftIntel) : "（尚未輸入文字）"}</div>
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  function renderMySentMessagesSummaryHtml(agentKey, otherAgentLabel) {
    const history = getAgentMessageHistory(agentKey);
    if (history.length === 0) {
      return `<div style="font-size:0.82rem;color:var(--muted);">💡 輸入上方數字與話術後按「同步傳送」，每一次傳送的內容都會保留在對方左欄及店長／觀察者畫面中，不會被覆蓋刪除。</div>`;
    }
    return `
      <div style="font-size:0.82rem;font-weight:700;color:var(--muted);margin-bottom:6px;">
        ✅ 你在本局已傳送給${escapeHtml(otherAgentLabel)}與店長／觀察者的紀錄（共 ${history.length} 筆・全程保留）：
      </div>
      <div class="agent-msg-history-list compact">
        ${history
          .map(
            (item, idx) => `
          <div class="agent-msg-item compact">
            <span class="agent-msg-badge">#${idx + 1}｜${escapeHtml(item.roundLabel || "第一輪")}</span>
            <strong class="num" style="color:var(--brick);margin:0 6px;">${
              item.offer !== null && item.offer !== undefined ? formatNum(item.offer) + " 萬" : "未填數字"
            }</strong>
            <span style="font-size:0.86rem;color:var(--text);">${escapeHtml(item.intel || "（無文字）")}</span>
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  function renderAgentPage(agentKey) {
    const isSellerAgent = agentKey === "sagent";
    const A = isSellerAgent ? CONTENT.SAGENT : CONTENT.BAGENT;
    const clientKey = isSellerAgent ? "seller" : "buyer";
    const clientLabel = isSellerAgent ? "屋主" : "買方";
    const otherAgentKey = isSellerAgent ? "bagent" : "sagent";
    const otherAgentLabel = isSellerAgent ? "買方仲介" : "賣方仲介";
    const reacts = isSellerAgent ? CONTENT.SELLER_REACT : CONTENT.BUYER_REACT;

    const cNode = state.roomData.clients[clientKey];
    const notes = getSyncedAgentNotes(agentKey);
    const agentHolderNick = (state.roomData.agents[agentKey] && state.roomData.agents[agentKey].byNick) || "";
    const checks = checkAgentLadder(agentKey, notes);
    const draftObj = (state.agentDraft && state.agentDraft[agentKey]) || { offer: "", intel: "" };

    const viewerBanner =
      state.role !== agentKey
        ? `<div class="alert ${isGameEnded() ? "alert-ok" : "alert-info"}">
            <span>${
              isGameEnded()
                ? `🎉 <strong>店長已宣布成交（遊戲結束）！</strong>目前已開放全體成員檢視 <strong>${escapeHtml(A.name)}${
                    agentHolderNick ? `（${escapeHtml(agentHolderNick)}）` : ""
                  }</strong> 的完整筆記與價格階梯。`
                : `👁️ 你目前以「<strong>${state.role === "manager" ? "店長" : "觀察者"}（${escapeHtml(
                    getMyLoginNick()
                  )}）</strong>」視角即時檢視 <strong>${escapeHtml(A.name)}${
                    agentHolderNick ? `（${escapeHtml(agentHolderNick)}）` : ""
                  }</strong> 的筆記與價格階梯。`
            }</span>
          </div>`
        : "";

    return `
      <div class="page-header">
        <h1>
          <span class="role-badge ${isSellerAgent ? "role-sagent" : "role-bagent"}">${escapeHtml(A.name)}</span>
          負責：${escapeHtml(A.client)}
        </h1>
        <span class="page-subtitle">${escapeHtml(A.intro)}</span>
      </div>

      ${viewerBanner}

      <div class="alert alert-info">
        <span>📌 <strong>仲介實戰任務：</strong>本案開價 <strong>${formatNum(CONTENT.CASE.ask)} 萬</strong> vs 買方斡旋 <strong>${formatNum(CONTENT.CASE.offer)} 萬</strong>。請透過「識局探索」問出客戶的真實數字與條件，並與另一位仲介交換情報後，在下方「價格階梯」<strong>自行推算並手填你的「目標成交價」</strong>！</span>
      </div>

      <!-- 即時連線區：你的客戶與另一位仲介 -->
      <div class="card">
        <div class="card-title">📡 連線：你的客戶（${clientLabel}）和另一位仲介（${otherAgentLabel}）</div>

        <h3 style="font-size:0.96rem;margin-bottom:8px;">${clientLabel}每一輪說的數字、條件與反應卡台詞</h3>
        <table class="resp-table" style="margin-bottom:16px;">
          <thead>
            <tr>
              <th>輪次</th>
              <th>${clientLabel}說的數字與條件</th>
              <th>抽到的反應卡台詞（僅顯示台詞）</th>
              <th>動作</th>
            </tr>
          </thead>
          <tbody>
            ${ROUND_LABELS.map((rLbl, idx) => {
              const r = cNode.rounds[String(idx)] || { price: null, cond: "", card: null };
              const hasCard = r.card !== null && r.card !== undefined && reacts[r.card];
              const cardNo = hasCard ? String(r.card + 1).padStart(2, "0") : "";
              const cardLine = hasCard ? `${clientLabel}反應卡 ${cardNo}：${reacts[r.card][0]}` : "尚未抽卡";
              const saidSummary =
                r.price !== null || r.cond
                  ? `${clientLabel}・${rLbl} 說：${r.price !== null ? formatNum(r.price) + " 萬" : "未填數字"}${
                      r.cond ? `，要換：${r.cond}` : ""
                    }`
                  : "尚未表態";
              return `
                <tr>
                  <td data-label="輪次"><strong>${escapeHtml(rLbl)}</strong></td>
                  <td data-label="${clientLabel}說的數字與條件"><strong>${escapeHtml(saidSummary)}</strong></td>
                  <td data-label="抽到的反應卡台詞">${escapeHtml(cardLine)}</td>
                  <td data-label="動作">
                    <button type="button" class="btn btn-sm btn-BringToLog" data-round="${idx}">⬇️ 帶入回合紀錄</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="form-grid">
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;border:1px solid var(--line);">
            <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
              <div class="field-label" style="margin-bottom:0;">📨 ${otherAgentLabel}傳來的話與帶過來的數字</div>
              <span style="font-size:0.75rem;color:var(--ok-text);font-weight:700;">📌 出現過的內容在遊戲中全程保留不刪除</span>
            </div>
            <div id="other-agent-msg-log-box">
              ${renderAgentMessageLogHtml(otherAgentKey, otherAgentLabel)}
            </div>
          </div>

          <div style="background:var(--light-bg);padding:12px;border-radius:8px;border:1px solid var(--line);">
            <div class="field-label">📤 傳給${otherAgentLabel}的話（同步給${otherAgentLabel}、店長與觀察者）</div>
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;margin-bottom:8px;">
              <div>
                <input type="number" id="inp-agent-offer" min="0" max="5000" step="10" placeholder="帶過去萬" value="${escapeHtml(
                  draftObj.offer || ""
                )}" />
              </div>
              <div>
                <input type="text" id="inp-agent-intel" maxlength="300" placeholder="輸入買方/屋主的故事與條件（最多 300 字）" value="${escapeHtml(
                  draftObj.intel || ""
                )}" />
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
              <button type="button" id="btn-send-agent-sync" class="btn btn-sm btn-primary">同步傳送給${otherAgentLabel}</button>
              <span id="agent-send-feedback" style="font-size:0.82rem;color:var(--ok-text);font-weight:700;"></span>
            </div>
            <div id="my-agent-sent-log-box" style="margin-top:10px;">
              ${renderMySentMessagesSummaryHtml(agentKey, otherAgentLabel)}
            </div>
          </div>
        </div>
      </div>

      <!-- 你的任務（6 項勾選） -->
      <div class="card">
        <div class="card-title">✅ 你的任務（做到就打勾）</div>
        <div class="task-check-grid">
          ${A.tasks
            .map(
              (t, i) => `
            <label class="task-check-label">
              <input type="checkbox" class="chk-agent-task" data-idx="${i}" ${notes.tasks[i] ? "checked" : ""} />
              <span>${escapeHtml(t)}</span>
            </label>`
            )
            .join("")}
        </div>
      </div>

      <!-- 仲介卡①：識局探索 + 交換情報 + 看出交集 -->
      <div class="card">
        <div class="card-title">🔍 識局探索（店長、觀察者與遊戲結束後全體成員可同步檢視）</div>
        <div class="form-grid">
          ${A.explore
            .map(
              (ex, i) => `
            <div>
              <label class="field-label">${escapeHtml(ex[0])}</label>
              <input type="text" class="inp-agent-explore" data-idx="${i}" placeholder="${escapeHtml(ex[1])}" value="${escapeHtml(
                notes.explore[i] || ""
              )}" />
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-title">🤝 交換情報與看出交集</div>
        <div class="form-grid" style="margin-bottom:14px;">
          ${A.intel
            .map(
              (lbl, i) => `
            <div>
              <label class="field-label">${escapeHtml(lbl)}</label>
              <input type="text" class="inp-agent-intel-note" data-idx="${i}" placeholder="跟另一位仲介交換情報後記下來" value="${escapeHtml(
                notes.intel[i] || ""
              )}" />
            </div>`
            )
            .join("")}
        </div>

        <table class="resp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>${escapeHtml(A.cross_head[0])}</th>
              <th>${escapeHtml(A.cross_head[1])}</th>
              <th>掛鉤句（If 條件句）</th>
            </tr>
          </thead>
          <tbody>
            ${[0, 1, 2]
              .map(
                (i) => `
              <tr>
                <td data-label="#"><strong>${i + 1}</strong></td>
                <td data-label="${escapeHtml(A.cross_head[0])}">
                  <input type="text" class="inp-cross-care" data-idx="${i}" value="${escapeHtml(notes.cross[i].care)}" />
                </td>
                <td data-label="${escapeHtml(A.cross_head[1])}">
                  <input type="text" class="inp-cross-give" data-idx="${i}" value="${escapeHtml(notes.cross[i].give)}" />
                </td>
                <td data-label="掛鉤句（If 條件句）">
                  <input type="text" class="inp-cross-hook" data-idx="${i}" placeholder="如果對方願意……，您可以……嗎？" value="${escapeHtml(
                    notes.cross[i].hook
                  )}" />
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- 仲介卡②：價格階梯與自動檢查 -->
      <div class="card">
        <div class="card-title">
          <span>🪜 ${escapeHtml(A.ladder_title)}</span>
          <span style="font-size:0.84rem;color:var(--accent);">「${escapeHtml(A.quote)}」</span>
        </div>
        <p style="margin-top:0;font-size:0.9rem;color:var(--muted);">${escapeHtml(A.ladder_hint)}</p>

        <table class="resp-table">
          <thead>
            <tr>
              <th style="width:110px;">步驟</th>
              <th style="width:120px;">數字（萬）</th>
              <th>柱子（勾選）與論述</th>
              <th>這一步要換什麼</th>
              <th>${escapeHtml(A.next_head)}</th>
            </tr>
          </thead>
          <tbody>
            ${A.ladder
              .map((lRow, idx) => {
                const nRow = notes.ladder[idx];
                const isTarget = idx === 2;
                const isEst = idx === 3;
                return `
                  <tr>
                    <td data-label="步驟">
                      <strong>${escapeHtml(lRow[0])}</strong>
                      <div style="font-size:0.78rem;color:var(--muted);">${escapeHtml(lRow[1])}</div>
                    </td>
                    <td data-label="數字（萬）">
                      <input type="number" class="inp-ladder-price" data-idx="${idx}" min="0" max="5000" step="10" placeholder="${
                        isTarget ? "自己推算目標價" : "萬"
                      }" value="${escapeHtml(nRow.price)}" />
                    </td>
                    <td data-label="柱子（勾選）與論述">
                      ${
                        !isEst
                          ? `<div class="pillars-wrap" style="margin-bottom:6px;">
                              ${CONTENT.PILLARS.map((pName) => {
                                const checked = Array.isArray(nRow.pillars) && nRow.pillars.includes(pName);
                                return `
                                  <label class="pillar-chip ${checked ? "checked" : ""}">
                                    <input type="checkbox" class="chk-ladder-pillar" data-idx="${idx}" value="${escapeHtml(pName)}" ${
                                      checked ? "checked" : ""
                                    } />
                                    <span>${escapeHtml(pName)}</span>
                                  </label>
                                `;
                              }).join("")}
                            </div>`
                          : ""
                      }
                      <input type="text" class="inp-ladder-arg" data-idx="${idx}" placeholder="${
                        isEst ? "為什麼推估這個數字？" : "用一句話寫出論述"
                      }" value="${escapeHtml(nRow.arg)}" />
                    </td>
                    <td data-label="這一步要換什麼">
                      ${
                        !isEst
                          ? `<input type="text" class="inp-ladder-cond" data-idx="${idx}" placeholder="要換到的條件" value="${escapeHtml(
                              nRow.cond
                            )}" />`
                          : `<span style="color:var(--muted);font-size:0.84rem;">—</span>`
                      }
                    </td>
                    <td data-label="${escapeHtml(A.next_head)}">
                      ${
                        !isEst
                          ? `<input type="text" class="inp-ladder-next" data-idx="${idx}" placeholder="退路／下一步" value="${escapeHtml(
                              nRow.next
                            )}" />`
                          : `<span style="color:var(--muted);font-size:0.84rem;">—</span>`
                      }
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>

        <!-- 自動檢查結果 -->
        <div class="check-list" id="agent-ladder-checks">
          ${checks
            .map(
              (c) => `
            <div class="check-item check-${c.type}">
              <span class="tag-badge">${escapeHtml(c.tag)}</span>
              <span>${escapeHtml(c.text)}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <!-- 回合紀錄 -->
      <div class="card">
        <div class="card-title">📝 回合紀錄</div>
        <table class="resp-table">
          <thead>
            <tr>
              <th>輪次</th>
              <th style="width:110px;">反應卡號</th>
              <th style="width:130px;">${escapeHtml(A.log_head)}</th>
              <th>我怎麼接</th>
              <th>換到的條件</th>
            </tr>
          </thead>
          <tbody>
            ${ROUND_LABELS.map((rLbl, idx) => {
              const lg = notes.logs[idx];
              return `
                <tr>
                  <td data-label="輪次"><strong>${escapeHtml(rLbl)}</strong></td>
                  <td data-label="反應卡號">
                    <input type="text" class="inp-log-card" data-idx="${idx}" placeholder="例：01" value="${escapeHtml(lg.card)}" />
                  </td>
                  <td data-label="${escapeHtml(A.log_head)}">
                    <input type="text" class="inp-log-price" data-idx="${idx}" placeholder="萬" value="${escapeHtml(lg.price)}" />
                  </td>
                  <td data-label="我怎麼接">
                    <input type="text" class="inp-log-reply" data-idx="${idx}" placeholder="你說了什麼化解" value="${escapeHtml(lg.reply)}" />
                  </td>
                  <td data-label="換到的條件">
                    <input type="text" class="inp-log-cond" data-idx="${idx}" placeholder="這輪換到什麼條件" value="${escapeHtml(lg.cond)}" />
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindAgentEvents(agentKey) {
    const isSellerAgent = agentKey === "sagent";
    const clientKey = isSellerAgent ? "seller" : "buyer";
    const notes = state.notes[agentKey];

    // 帶入回合紀錄按鈕
    document.querySelectorAll(".btn-BringToLog").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rIdx = Number(btn.getAttribute("data-round"));
        const cRound = state.roomData.clients[clientKey].rounds[String(rIdx)] || {};
        if (cRound.card !== null && cRound.card !== undefined) {
          notes.logs[rIdx].card = String(Number(cRound.card) + 1).padStart(2, "0");
        }
        if (cRound.price !== null && cRound.price !== undefined) {
          notes.logs[rIdx].price = String(cRound.price);
        }
        if (cRound.cond) {
          notes.logs[rIdx].cond = String(cRound.cond);
        }
        saveNotes();
        syncAgentNotesToRoom(agentKey);
        renderAll();
      });
    });

    // 同步給另一位仲介、店長與觀察者（左邊出現過的歷史內容在遊戲中全程保留不刪除）
    const inpOffer = document.getElementById("inp-agent-offer");
    const inpIntel = document.getElementById("inp-agent-intel");
    const otherAgentLabel = isSellerAgent ? "買方仲介" : "賣方仲介";

    const updateDraftPreview = () => {
      if (!state.agentDraft[agentKey]) {
        state.agentDraft[agentKey] = { offer: "", intel: "", currentDraftId: null };
      }
      state.agentDraft[agentKey].offer = inpOffer.value;
      state.agentDraft[agentKey].intel = inpIntel.value;
      syncAgentNotesToRoom(agentKey, true);
    };

    const handleAutoCommitOnBlur = () => {
      if (!state.agentDraft[agentKey]) {
        state.agentDraft[agentKey] = { offer: "", intel: "", currentDraftId: null };
      }
      state.agentDraft[agentKey].offer = inpOffer.value;
      state.agentDraft[agentKey].intel = inpIntel.value;
      const saved = commitAgentMessageHistory(agentKey, inpOffer.value, inpIntel.value, false);
      if (saved) {
        const myLogBox = document.getElementById("my-agent-sent-log-box");
        if (myLogBox) {
          myLogBox.innerHTML = renderMySentMessagesSummaryHtml(agentKey, otherAgentLabel);
        }
      }
    };

    const handleExplicitSend = () => {
      const saved = commitAgentMessageHistory(agentKey, inpOffer.value, inpIntel.value, true);
      if (saved) {
        inpOffer.value = "";
        inpIntel.value = "";
        const fbEl = document.getElementById("agent-send-feedback");
        if (fbEl) {
          fbEl.textContent = "✅ 已傳送並永久保留於本局紀錄中！";
          setTimeout(() => {
            const el = document.getElementById("agent-send-feedback");
            if (el) el.textContent = "";
          }, 2500);
        }
      } else {
        const fbEl = document.getElementById("agent-send-feedback");
        if (fbEl) {
          fbEl.textContent = "⚠️ 請先輸入要帶過去的數字或傳話內容";
        }
      }
    };

    inpOffer.addEventListener("input", updateDraftPreview);
    inpIntel.addEventListener("input", updateDraftPreview);
    inpOffer.addEventListener("change", handleAutoCommitOnBlur);
    inpIntel.addEventListener("change", handleAutoCommitOnBlur);
    inpOffer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleExplicitSend();
      }
    });
    inpIntel.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleExplicitSend();
      }
    });
    document.getElementById("btn-send-agent-sync").addEventListener("click", handleExplicitSend);

    // 任務勾選
    document.querySelectorAll(".chk-agent-task").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = Number(chk.getAttribute("data-idx"));
        notes.tasks[idx] = chk.checked;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });

    // 識局探索
    document.querySelectorAll(".inp-agent-explore").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.getAttribute("data-idx"));
        notes.explore[idx] = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });

    // 交換情報
    document.querySelectorAll(".inp-agent-intel-note").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.getAttribute("data-idx"));
        notes.intel[idx] = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });

    // 看出交集
    document.querySelectorAll(".inp-cross-care").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].care = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
    document.querySelectorAll(".inp-cross-give").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].give = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
    document.querySelectorAll(".inp-cross-hook").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].hook = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });

    // 價格階梯與即時重算檢查
    const refreshLadderChecks = () => {
      saveNotes();
      syncAgentNotesToRoom(agentKey);
      const checks = checkAgentLadder(agentKey);
      const box = document.getElementById("agent-ladder-checks");
      if (box) {
        box.innerHTML = checks
          .map(
            (c) => `
          <div class="check-item check-${c.type}">
            <span class="tag-badge">${escapeHtml(c.tag)}</span>
            <span>${escapeHtml(c.text)}</span>
          </div>`
          )
          .join("");
      }
    };

    document.querySelectorAll(".inp-ladder-price").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.getAttribute("data-idx"));
        notes.ladder[idx].price = inp.value;
        refreshLadderChecks();
      });
    });
    document.querySelectorAll(".chk-ladder-pillar").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = Number(chk.getAttribute("data-idx"));
        const val = chk.value;
        const arr = Array.isArray(notes.ladder[idx].pillars) ? [...notes.ladder[idx].pillars] : [];
        if (chk.checked) {
          if (!arr.includes(val)) arr.push(val);
        } else {
          const pos = arr.indexOf(val);
          if (pos >= 0) arr.splice(pos, 1);
        }
        notes.ladder[idx].pillars = arr;
        chk.parentElement.classList.toggle("checked", chk.checked);
        refreshLadderChecks();
      });
    });
    document.querySelectorAll(".inp-ladder-arg").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.ladder[Number(inp.getAttribute("data-idx"))].arg = inp.value;
        refreshLadderChecks();
      });
    });
    document.querySelectorAll(".inp-ladder-cond").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.ladder[Number(inp.getAttribute("data-idx"))].cond = inp.value;
        refreshLadderChecks();
      });
    });
    document.querySelectorAll(".inp-ladder-next").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.ladder[Number(inp.getAttribute("data-idx"))].next = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });

    // 回合紀錄
    document.querySelectorAll(".inp-log-card").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].card = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
    document.querySelectorAll(".inp-log-price").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].price = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
    document.querySelectorAll(".inp-log-reply").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].reply = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
    document.querySelectorAll(".inp-log-cond").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].cond = inp.value;
        saveNotes();
        syncAgentNotesToRoom(agentKey);
      });
    });
  }

  // ==================== 5.5 店長頁 ＆ 觀察者頁 ＆ 具名回饋同步子夾系統 ====================
  function renderFullCardForViewer(clientKey, cardIdx) {
    const reacts = clientKey === "seller" ? CONTENT.SELLER_REACT : CONTENT.BUYER_REACT;
    const label = clientKey === "seller" ? "屋主反應卡" : "買方反應卡";
    if (cardIdx === null || cardIdx === undefined || !reacts[cardIdx]) {
      return `<span style="color:var(--muted);">尚未抽卡</span>`;
    }
    const c = reacts[cardIdx];
    const no = String(cardIdx + 1).padStart(2, "0");
    return `
      <div><strong>${label} ${no}：${escapeHtml(c[0])}</strong></div>
      <div style="font-size:0.84rem;color:var(--muted);">🎭 怎麼演：${escapeHtml(c[1])}</div>
      <div style="font-size:0.84rem;">🔑 仲介要做到：${escapeHtml(c[2])}</div>
      <div style="font-size:0.84rem;color:var(--ok-text);">✅ 做到 → ${escapeHtml(c[3])} ｜ ❌ 沒做到 → ${escapeHtml(c[4])}</div>
    `;
  }

  function renderQuickRolePeekBar(viewerRoleTitle) {
    return `
      <div class="card" style="background:#FFF9F2;border-color:var(--accent);">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <strong>🔓 ${escapeHtml(viewerRoleTitle)}全場視角權限：</strong>
            <span style="font-size:0.9rem;color:var(--muted);">可隨時切換查看所有角色的秘密字卡、識局筆記與價格階梯</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <a href="#seller" class="btn btn-sm"><span class="role-dot" style="background:#9B2A1F"></span> 看屋主秘密卡</a>
            <a href="#buyer" class="btn btn-sm"><span class="role-dot" style="background:#2F5D62"></span> 看買方秘密卡</a>
            <a href="#sagent" class="btn btn-sm"><span class="role-dot" style="background:#8B6A45"></span> 看賣方仲介筆記</a>
            <a href="#bagent" class="btn btn-sm"><span class="role-dot" style="background:#5E6B34"></span> 看買方仲介筆記</a>
            <a href="#board" class="btn btn-sm">📈 看議價看板</a>
          </div>
        </div>
      </div>
    `;
  }

  function renderLiveTableCard() {
    const sClient = state.roomData.clients.seller;
    const bClient = state.roomData.clients.buyer;

    return `
      <div class="card">
        <div class="card-title">
          <span>👀 即時牌桌（全組同步・可看雙方完整反應卡與買賣方經紀人歷次傳話）</span>
          <span style="font-size:0.8rem;color:var(--ok-text);font-weight:700;">📌 經紀人傳話與數字全程保留不刪除</span>
        </div>
        <table class="resp-table" style="margin-bottom:14px;">
          <thead>
            <tr>
              <th>輪次</th>
              <th>屋主（數字／條件／完整反應卡）</th>
              <th>買方（數字／條件／完整反應卡）</th>
            </tr>
          </thead>
          <tbody>
            ${ROUND_LABELS.map((rLbl, idx) => {
              const sr = sClient.rounds[String(idx)] || {};
              const br = bClient.rounds[String(idx)] || {};
              return `
                <tr>
                  <td data-label="輪次"><strong>${escapeHtml(rLbl)}</strong></td>
                  <td data-label="屋主">
                    <div style="margin-bottom:6px;">
                      <strong>數字：${sr.price !== null && sr.price !== undefined ? formatNum(sr.price) + " 萬" : "—"}</strong>
                      ｜ 條件：${escapeHtml(sr.cond || "—")}
                    </div>
                    ${renderFullCardForViewer("seller", sr.card)}
                  </td>
                  <td data-label="買方">
                    <div style="margin-bottom:6px;">
                      <strong>數字：${br.price !== null && br.price !== undefined ? formatNum(br.price) + " 萬" : "—"}</strong>
                      ｜ 條件：${escapeHtml(br.cond || "—")}
                    </div>
                    ${renderFullCardForViewer("buyer", br.card)}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="form-grid">
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;border:1px solid var(--line);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;">
              <strong><span class="role-badge role-sagent">賣方仲介 → 買方仲介</span> 傳來的話與帶過去的數字</strong>
            </div>
            ${renderAgentMessageLogHtml("sagent", "賣方仲介")}
          </div>
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;border:1px solid var(--line);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;">
              <strong><span class="role-badge role-bagent">買方仲介 → 賣方仲介</span> 傳來的話與帶過去的數字</strong>
            </div>
            ${renderAgentMessageLogHtml("bagent", "買方仲介")}
          </div>
        </div>
      </div>
    `;
  }

  function renderSingleAgentSyncColumn(agentKey) {
    const isSellerAgent = agentKey === "sagent";
    const A = isSellerAgent ? CONTENT.SAGENT : CONTENT.BAGENT;
    const badgeCls = isSellerAgent ? "role-sagent" : "role-bagent";
    const otherAgentLabel = isSellerAgent ? "買方仲介" : "賣方仲介";
    const agNode = (state.roomData && state.roomData.agents && state.roomData.agents[agentKey]) || createEmptyAgentNode();
    const notes = getSyncedAgentNotes(agentKey);

    // 找出房間內擔任此角色的學員暱稱
    const playersMap = (state.roomData && state.roomData.players) || {};
    const holderNicks = Object.values(playersMap)
      .filter((p) => p && p.online && p.role === agentKey)
      .map((p) => p.nick || "學員");
    const displayNick = holderNicks.length > 0 ? holderNicks.join("、") : agNode.byNick || "尚未指派";

    const doneTaskCount = Array.isArray(notes.tasks) ? notes.tasks.filter(Boolean).length : 0;

    // 識局探索已填項目
    const filledExplore = A.explore
      .map((ex, i) => ({ label: ex[0], val: String((notes.explore && notes.explore[i]) || "").trim() }))
      .filter((x) => x.val.length > 0);

    // 交換情報已填項目
    const filledIntel = A.intel
      .map((lbl, i) => ({ label: lbl, val: String((notes.intel && notes.intel[i]) || "").trim() }))
      .filter((x) => x.val.length > 0);

    // 看出交集已填項目
    const filledCross = [0, 1, 2]
      .map((i) => (notes.cross && notes.cross[i]) || { care: "", give: "", hook: "" })
      .filter((c) => c.care || c.give || c.hook);

    // 回合紀錄已填項目
    const filledLogs = ROUND_LABELS.map((rLbl, idx) => {
      const lg = (notes.logs && notes.logs[idx]) || { card: "", price: "", reply: "", cond: "" };
      return { rLbl, lg, hasAny: !!(lg.card || lg.price || lg.reply || lg.cond) };
    }).filter((x) => x.hasAny);

    return `
      <div class="agent-sync-panel">
        <div class="agent-sync-panel-head">
          <div>
            <span class="role-badge ${badgeCls}">${escapeHtml(A.name)}</span>
            <strong style="margin-left:6px;">👤 經紀人：${escapeHtml(displayNick)}</strong>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.8rem;color:var(--muted);">任務勾選：<strong>${doneTaskCount}/6</strong></span>
            <a href="#${agentKey}" class="btn btn-sm">開啟完整頁籤 ↗</a>
          </div>
        </div>

        <!-- 1. 傳給對方仲介的話與帶過去的數字 -->
        <div class="agent-sync-subbox">
          <div class="agent-sync-subtitle">📨 1. 傳給${escapeHtml(otherAgentLabel)}的話與帶過去的數字（全程保留不刪除）</div>
          ${renderAgentMessageLogHtml(agentKey, A.name)}
        </div>

        <!-- 2. 價格階梯規劃 -->
        <div class="agent-sync-subbox">
          <div class="agent-sync-subtitle">🪜 2. ${escapeHtml(A.ladder_title)}</div>
          <table class="resp-table" style="font-size:0.86rem;margin-bottom:0;">
            <thead>
              <tr>
                <th>步驟</th>
                <th>數字（萬）</th>
                <th>柱子與論述</th>
                <th>換條件／退路</th>
              </tr>
            </thead>
            <tbody>
              ${A.ladder
                .map((lRow, idx) => {
                  const nRow = (notes.ladder && notes.ladder[idx]) || { price: "", pillars: [], arg: "", cond: "", next: "" };
                  const isEst = idx === 3;
                  const pillarsStr = Array.isArray(nRow.pillars) && nRow.pillars.length > 0 ? `【${nRow.pillars.join("、")}】` : "";
                  return `
                    <tr>
                      <td data-label="步驟"><strong>${escapeHtml(lRow[0])}</strong></td>
                      <td data-label="數字（萬）"><strong class="num" style="color:var(--brick);">${
                        nRow.price ? escapeHtml(nRow.price) + " 萬" : "—"
                      }</strong></td>
                      <td data-label="柱子與論述">${
                        pillarsStr || nRow.arg
                          ? `<span style="color:var(--accent);font-weight:700;">${escapeHtml(pillarsStr)}</span> ${escapeHtml(nRow.arg || "")}`
                          : "—"
                      }</td>
                      <td data-label="換條件／退路">${
                        isEst
                          ? "—"
                          : nRow.cond || nRow.next
                          ? `換：${escapeHtml(nRow.cond || "—")} ／ 退：${escapeHtml(nRow.next || "—")}`
                          : "—"
                      }</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>

        <!-- 3. 識局探索與交換情報 -->
        <div class="agent-sync-subbox">
          <div class="agent-sync-subtitle">🔍 3. 識局探索、交換情報與看出交集</div>
          ${
            filledExplore.length === 0 && filledIntel.length === 0 && filledCross.length === 0
              ? `<div style="font-size:0.86rem;color:var(--muted);">（${escapeHtml(A.name)}尚未填寫識局探索與交換情報筆記）</div>`
              : `
                ${
                  filledExplore.length > 0
                    ? `<div style="margin-bottom:8px;">
                        <div style="font-size:0.8rem;font-weight:900;color:var(--accent);margin-bottom:4px;">▸ 識局探索：</div>
                        ${filledExplore
                          .map(
                            (x) =>
                              `<div style="font-size:0.86rem;margin-bottom:2px;"><strong>${escapeHtml(x.label)}：</strong>${escapeHtml(x.val)}</div>`
                          )
                          .join("")}
                      </div>`
                    : ""
                }
                ${
                  filledIntel.length > 0
                    ? `<div style="margin-bottom:8px;">
                        <div style="font-size:0.8rem;font-weight:900;color:var(--accent);margin-bottom:4px;">▸ 交換情報：</div>
                        ${filledIntel
                          .map(
                            (x) =>
                              `<div style="font-size:0.86rem;margin-bottom:2px;"><strong>${escapeHtml(x.label)}：</strong>${escapeHtml(x.val)}</div>`
                          )
                          .join("")}
                      </div>`
                    : ""
                }
                ${
                  filledCross.length > 0
                    ? `<div>
                        <div style="font-size:0.8rem;font-weight:900;color:var(--accent);margin-bottom:4px;">▸ 看出交集（If 條件掛鉤句）：</div>
                        ${filledCross
                          .map(
                            (c, i) =>
                              `<div style="font-size:0.86rem;margin-bottom:2px;">#${i + 1} 在乎：${escapeHtml(c.care || "—")} ｜ 可給：${escapeHtml(
                                c.give || "—"
                              )} ｜ 掛鉤句：<strong>${escapeHtml(c.hook || "—")}</strong></div>`
                          )
                          .join("")}
                      </div>`
                    : ""
                }
              `
          }
        </div>

        <!-- 4. 回合紀錄 -->
        <div class="agent-sync-subbox" style="margin-bottom:0;">
          <div class="agent-sync-subtitle">📝 4. 各輪回合紀錄</div>
          ${
            filledLogs.length === 0
              ? `<div style="font-size:0.86rem;color:var(--muted);">（${escapeHtml(A.name)}尚未填寫回合紀錄）</div>`
              : filledLogs
                  .map(
                    (row) => `
                  <div style="font-size:0.86rem;margin-bottom:4px;">
                    <strong>${escapeHtml(row.rLbl)}</strong>｜卡號：${escapeHtml(row.lg.card || "—")}｜價格：<strong class="num">${escapeHtml(
                      row.lg.price ? row.lg.price + " 萬" : "—"
                    )}</strong>｜接招：${escapeHtml(row.lg.reply || "—")}｜換條件：${escapeHtml(row.lg.cond || "—")}
                  </div>`
                  )
                  .join("")
          }
        </div>
      </div>
    `;
  }

  function renderAgentsSyncOverviewCard() {
    return `
      <div class="card">
        <div class="card-title">
          <span>👔 買賣方經紀人（賣方仲介 ＆ 買方仲介）即時內容同步欄位</span>
          <span style="font-size:0.84rem;color:var(--muted);">店長與觀察者可在此即時同步掌握雙方經紀人的傳話、價格階梯與識局筆記</span>
        </div>
        <div class="form-grid">
          ${renderSingleAgentSyncColumn("sagent")}
          ${renderSingleAgentSyncColumn("bagent")}
        </div>
      </div>
    `;
  }

  function getCollectedObserversList() {
    const obsMap = Object.assign({}, (state.roomData && state.roomData.observers) || {});
    const playersMap = (state.roomData && state.roomData.players) || {};

    // 整理並確保署名使用玩家在房間登入的名字
    const list = Object.entries(obsMap)
      .map(([key, item]) => {
        if (!item || typeof item !== "object") return null;
        const rawUid = item.uid || key.replace(/_(obs|mgr)$/, "");
        const pNode = playersMap[rawUid];
        const loginNick = (pNode && pNode.nick) || item.nick || "匿名觀察者";
        const sChecks = Array.isArray(item.s_checks) ? item.s_checks.map(Boolean) : [false, false, false, false, false, false];
        const bChecks = Array.isArray(item.b_checks) ? item.b_checks.map(Boolean) : [false, false, false, false, false, false];
        const stages = Object.assign({ stage1: "", stage2: "", stage3: "", stage4: "" }, item.stages || {});
        const fb1 = String(item.fb1 || "").trim();
        const fb2 = String(item.fb2 || "").trim();
        const fb3 = String(item.fb3 || "").trim();
        const hasAnyCheck = sChecks.some(Boolean) || bChecks.some(Boolean);
        const hasAnyStage = Object.values(stages).some((v) => String(v || "").trim().length > 0);
        const hasAnyFb = !!(fb1 || fb2 || fb3);
        if (!hasAnyCheck && !hasAnyStage && !hasAnyFb) return null;
        return {
          key,
          uid: rawUid,
          nick: loginNick,
          role: item.role === "manager" ? "manager" : "observer",
          updatedAt: Number(item.updatedAt || 0),
          s_checks: sChecks,
          b_checks: bChecks,
          stages,
          fb1,
          fb2,
          fb3
        };
      })
      .filter(Boolean);

    list.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    return list;
  }

  function renderCollapsibleFeedList(items, folderId, itemLabel) {
    if (!items || items.length === 0) {
      return `<div style="color:var(--muted);font-size:0.88rem;padding:6px 0;">尚無觀察者填寫此項回饋</div>`;
    }

    const renderSingleItem = (it, idx) => {
      const roleBadgeCls = it.role === "manager" ? "role-manager" : "role-observer";
      const roleTitle = it.role === "manager" ? "店長" : "觀察者";
      return `
        <div class="obs-feed-item">
          <div class="obs-feed-head">
            <span class="obs-sig-badge ${roleBadgeCls}">✍️ 署名：${escapeHtml(it.nick)}（${roleTitle}）</span>
            <span style="font-size:0.78rem;color:var(--muted);">#${idx + 1}</span>
          </div>
          <div class="obs-feed-text">${escapeHtml(it.text)}</div>
        </div>
      `;
    };

    const visibleItems = items.slice(0, 3);
    const hiddenItems = items.slice(3);

    let html = `<div class="obs-feed-list">${visibleItems.map((it, i) => renderSingleItem(it, i)).join("")}</div>`;

    if (hiddenItems.length > 0) {
      const isOpen = openSubfolderIds.has(folderId) ? "open" : "";
      const extraAuthors = hiddenItems.map((h) => h.nick).join("、");
      html += `
        <details class="obs-subfolder" data-folder-id="${escapeHtml(folderId)}" ${isOpen}>
          <summary class="obs-subfolder-summary">
            <span>📂 超過 3 則回饋，已收起更多${escapeHtml(itemLabel)}（另有 <strong>${hiddenItems.length}</strong> 則｜署名：${escapeHtml(
        extraAuthors
      )}）</span>
            <span class="obs-subfolder-toggle-tip">點開查看內容 ▾</span>
          </summary>
          <div class="obs-subfolder-body">
            ${hiddenItems.map((it, i) => renderSingleItem(it, i + 3)).join("")}
          </div>
        </details>
      `;
    }

    return html;
  }

  function renderSyncedObserversBoardInner() {
    const obsList = getCollectedObserversList();
    const M = CONTENT.MANAGER;

    const renderObserverCard = (obs, idx) => {
      const roleBadgeCls = obs.role === "manager" ? "role-manager" : "role-observer";
      const roleTitle = obs.role === "manager" ? "店長" : "觀察者";
      const sCount = obs.s_checks.filter(Boolean).length;
      const bCount = obs.b_checks.filter(Boolean).length;
      const sDoneNames = M.s_checks.filter((_, i) => obs.s_checks[i]);
      const bDoneNames = M.b_checks.filter((_, i) => obs.b_checks[i]);

      return `
        <div class="obs-person-card">
          <div class="obs-person-head">
            <span class="obs-sig-badge ${roleBadgeCls}">👤 署名：${escapeHtml(obs.nick)}（${roleTitle}）</span>
            <span style="font-size:0.84rem;font-weight:700;color:var(--text);">
              賣方仲介做到 <strong>${sCount}/6</strong> 項 ｜ 買方仲介做到 <strong>${bCount}/6</strong> 項
            </span>
          </div>
          ${
            sDoneNames.length > 0 || bDoneNames.length > 0
              ? `<div style="font-size:0.84rem;color:var(--muted);margin-top:6px;">
                  ${sDoneNames.length > 0 ? `<div><strong>賣方仲介已做到：</strong>${escapeHtml(sDoneNames.join("、"))}</div>` : ""}
                  ${bDoneNames.length > 0 ? `<div><strong>買方仲介已做到：</strong>${escapeHtml(bDoneNames.join("、"))}</div>` : ""}
                </div>`
              : ""
          }
        </div>
      `;
    };

    const visibleCards = obsList.slice(0, 3);
    const hiddenCards = obsList.slice(3);
    const cardsFolderId = "obs_person_cards_extra";
    const cardsOpen = openSubfolderIds.has(cardsFolderId) ? "open" : "";

    return `
      <div class="card">
        <div class="card-title">
          <span>📋 全場觀察者＆店長回饋即時同步看板（具名署名・超過 3 則自動子夾收起）</span>
          <span style="font-size:0.84rem;color:var(--muted);">目前已有 ${obsList.length} 位觀察者／店長同步填寫</span>
        </div>

        <!-- 一、各環節觀察到的事情（4 個環節） -->
        <h3 style="font-size:1.02rem;margin:8px 0 10px;color:var(--dark-band);">🔎 一、各環節觀察紀錄（同步具名彙整）</h3>
        <div class="obs-stage-board-grid" style="margin-bottom:18px;">
          ${OBSERVER_STAGES.map((st) => {
            const entries = obsList
              .map((o) => ({
                nick: o.nick,
                role: o.role,
                text: String((o.stages && o.stages[st.key]) || "").trim()
              }))
              .filter((x) => x.text.length > 0);
            return `
              <div class="obs-stage-group">
                <div class="obs-stage-group-title">
                  <span>${escapeHtml(st.title)}</span>
                  <span class="obs-count-pill">${entries.length} 則回饋</span>
                </div>
                ${renderCollapsibleFeedList(entries, `stage_${st.key}`, "環節觀察")}
              </div>
            `;
          }).join("")}
        </div>

        <!-- 二、遊戲結束時的收尾回饋三題 -->
        <h3 style="font-size:1.02rem;margin:16px 0 10px;color:var(--dark-band);">💬 二、結束時的收尾回饋問題（同步具名彙整）</h3>
        <div class="obs-stage-board-grid" style="margin-bottom:18px;">
          ${OBSERVER_FB_QUESTIONS.map((q) => {
            const entries = obsList
              .map((o) => ({
                nick: o.nick,
                role: o.role,
                text: String(o[q.key] || "").trim()
              }))
              .filter((x) => x.text.length > 0);
            return `
              <div class="obs-stage-group">
                <div class="obs-stage-group-title">
                  <span>${escapeHtml(q.title)}</span>
                  <span class="obs-count-pill">${entries.length} 則回饋</span>
                </div>
                ${renderCollapsibleFeedList(entries, `fb_${q.key}`, "收尾回饋")}
              </div>
            `;
          }).join("")}
        </div>

        <!-- 三、觀察者檢核打勾統計（超過 3 人同樣子夾收起） -->
        <h3 style="font-size:1.02rem;margin:16px 0 10px;color:var(--dark-band);">☑️ 三、各觀察者檢核表打勾彙整</h3>
        ${
          obsList.length === 0
            ? `<div style="color:var(--muted);font-size:0.9rem;">目前尚無觀察者或店長勾選檢核表或輸入回饋。</div>`
            : `
              <div class="obs-feed-list">
                ${visibleCards.map((o, i) => renderObserverCard(o, i)).join("")}
              </div>
              ${
                hiddenCards.length > 0
                  ? `<details class="obs-subfolder" data-folder-id="${cardsFolderId}" ${cardsOpen}>
                      <summary class="obs-subfolder-summary">
                        <span>📂 超過 3 位觀察者檢核紀錄，已收起更多檢核卡（另有 <strong>${hiddenCards.length}</strong> 位｜署名：${escapeHtml(
                      hiddenCards.map((h) => h.nick).join("、")
                    )}）</span>
                        <span class="obs-subfolder-toggle-tip">點開查看內容 ▾</span>
                      </summary>
                      <div class="obs-subfolder-body">
                        ${hiddenCards.map((o, i) => renderObserverCard(o, i + 3)).join("")}
                      </div>
                    </details>`
                  : ""
              }
            `
        }
      </div>
    `;
  }

  function renderManagerPage() {
    const M = CONTENT.MANAGER;
    const mRound = state.roomData.manager ? Number(state.roomData.manager.round || 0) : 0;
    const dealVal = state.roomData.manager && state.roomData.manager.deal;
    const mNotes = state.notes.manager;

    return `
      <div class="page-header">
        <h1><span class="role-badge role-manager">店長（限 1 人）</span> 全場控台與宣布成交</h1>
        <div class="round-tabs">
          ${ROUND_LABELS.map(
            (lbl, idx) => `
            <button type="button" class="round-btn btn-manager-round ${mRound === idx ? "active" : ""}" data-round="${idx}">
              切換至：${escapeHtml(lbl)}
            </button>`
          ).join("")}
        </div>
      </div>

      <div class="alert alert-info">
        <span>🎯 <strong>店長字卡專屬提示｜本劇本目標成交價：${formatNum(CONTENT.CASE.target)} 萬</strong>（屋主真正底線與買方真正上限皆涵蓋此目標價，兩輪後差距 40 萬內請出面完成最後一步；按下「宣布成交」後將開放所有人查看全部角色細節！）</span>
      </div>

      ${renderGameStartControlCard()}
      ${renderQuickRolePeekBar("店長")}
      ${renderLiveTableCard()}
      ${renderAgentsSyncOverviewCard()}

      <!-- 最後一步台詞範例 + 宣布成交 -->
      <div class="card">
        <div class="card-title">🏆 最後一步：店長出面（下黑上白）＆ 宣布成交（解鎖全體視角）</div>
        <div class="form-grid" style="margin-bottom:16px;">
          ${M.final
            .map(
              (f) => `
            <div style="background:var(--light-bg);padding:12px;border-radius:8px;">
              <strong>${escapeHtml(f[0])}台詞範例：</strong>
              <div style="margin-top:4px;">${escapeHtml(f[1])}</div>
            </div>`
            )
            .join("")}
        </div>

        <div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;background:var(--ok-bg);padding:14px;border-radius:10px;">
          <div style="min-width:180px;">
            <label class="field-label" for="inp-mgr-deal">成交價（萬）</label>
            <input type="number" id="inp-mgr-deal" min="0" max="5000" step="10" placeholder="${getTargetPriceStr()}" value="${
              dealVal !== null && dealVal !== undefined ? escapeHtml(dealVal) : getTargetPriceStr()
            }" />
          </div>
          <button type="button" id="btn-announce-deal" class="btn btn-primary">🎉 宣布成交（全組跳出橫幅＋開放所有人看全部角色細節）</button>
          ${
            dealVal !== null && dealVal !== undefined
              ? `<button type="button" id="btn-clear-deal" class="btn">收回成交狀態（恢復角色鎖定）</button>`
              : ""
          }
        </div>
      </div>

      <!-- 店長自己的檢核表、各環節觀察與收尾回饋（也會具名同步至全場回饋看板） -->
      <div class="card">
        <div class="card-title">
          <span>☑️ 店長觀察檢核表（做到就打勾）</span>
          <span class="obs-sig-badge role-manager">✍️ 署名：${escapeHtml(getMyLoginNick())}（店長）</span>
        </div>
        <div class="form-grid">
          <div>
            <h3 style="font-size:0.96rem;margin-bottom:8px;"><span class="role-badge role-sagent">賣方仲介 6 項</span></h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${M.s_checks
                .map(
                  (c, i) => `
                <label class="task-check-label">
                  <input type="checkbox" class="chk-mgr-s" data-idx="${i}" ${mNotes.s_checks[i] ? "checked" : ""} />
                  <span>${escapeHtml(c)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>
          <div>
            <h3 style="font-size:0.96rem;margin-bottom:8px;"><span class="role-badge role-bagent">買方仲介 6 項</span></h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${M.b_checks
                .map(
                  (c, i) => `
                <label class="task-check-label">
                  <input type="checkbox" class="chk-mgr-b" data-idx="${i}" ${mNotes.b_checks[i] ? "checked" : ""} />
                  <span>${escapeHtml(c)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>🔎 店長各環節觀察筆記（即時具名同步至網頁）</span>
          <span style="font-size:0.84rem;color:var(--muted);">署名：${escapeHtml(getMyLoginNick())}</span>
        </div>
        <div class="form-grid">
          ${OBSERVER_STAGES.map(
            (st) => `
            <div>
              <label class="field-label">${escapeHtml(st.title)}</label>
              <textarea class="inp-mgr-stage" data-stage="${st.key}" placeholder="${escapeHtml(st.placeholder)}">${escapeHtml(
              (mNotes.stages && mNotes.stages[st.key]) || ""
            )}</textarea>
            </div>`
          ).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span>💬 店長收尾回饋三題（10 分鐘・即時具名同步至網頁）</span>
          <span style="font-size:0.84rem;color:var(--muted);">署名：${escapeHtml(getMyLoginNick())}</span>
        </div>
        <div class="form-grid">
          ${OBSERVER_FB_QUESTIONS.map(
            (q) => `
            <div>
              <label class="field-label">${escapeHtml(q.title)}</label>
              <textarea id="inp-mgr-${q.key}" data-fb="${q.key}" placeholder="${escapeHtml(q.placeholder)}">${escapeHtml(
              mNotes[q.key] || ""
            )}</textarea>
            </div>`
          ).join("")}
        </div>
      </div>

      <div id="synced-observers-board">
        ${renderSyncedObserversBoardInner()}
      </div>
    `;
  }

  function bindManagerEvents() {
    document.querySelectorAll(".btn-manager-round").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = Number(btn.getAttribute("data-round"));
        writeRoomPatch("manager/updatedAt", Date.now(), true);
        writeRoomPatch("manager/round", r, true);
        writeRoomPatch("manager/by", state.uid);
      });
    });

    document.querySelectorAll(".chk-mgr-s").forEach((chk) => {
      chk.addEventListener("change", () => {
        state.notes.manager.s_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
        syncMyObserverRecord("manager", true);
      });
    });
    document.querySelectorAll(".chk-mgr-b").forEach((chk) => {
      chk.addEventListener("change", () => {
        state.notes.manager.b_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
        syncMyObserverRecord("manager", true);
      });
    });

    document.querySelectorAll(".inp-mgr-stage").forEach((el) => {
      el.addEventListener("input", () => {
        const sKey = el.getAttribute("data-stage");
        if (!state.notes.manager.stages) state.notes.manager.stages = { stage1: "", stage2: "", stage3: "", stage4: "" };
        state.notes.manager.stages[sKey] = el.value;
        saveNotes();
        syncMyObserverRecord("manager", true);
      });
    });

    const inpDeal = document.getElementById("inp-mgr-deal");
    document.getElementById("btn-announce-deal").addEventListener("click", () => {
      const val = sanitizePrice(inpDeal.value);
      if (val !== null) {
        writeRoomPatch("manager/updatedAt", Date.now(), true);
        writeRoomPatch("manager/deal", val, true);
        writeRoomPatch("manager/by", state.uid);
      }
    });
    const btnClearDeal = document.getElementById("btn-clear-deal");
    if (btnClearDeal) {
      btnClearDeal.addEventListener("click", () => {
        writeRoomPatch("manager/updatedAt", Date.now(), true);
        writeRoomPatch("manager/deal", null);
      });
    }

    ["fb1", "fb2", "fb3"].forEach((k) => {
      const el = document.getElementById(`inp-mgr-${k}`);
      if (el) {
        el.addEventListener("input", () => {
          state.notes.manager[k] = el.value;
          saveNotes();
          syncMyObserverRecord("manager", true);
        });
      }
    });
  }

  // ==================== 5.5b 觀察者專頁（不限人數・各環節觀察＋結束回饋具名同步） ====================
  function renderObserverPage() {
    const M = CONTENT.MANAGER;
    const oNotes = state.notes.observer || createDefaultObserverNotes();
    const myNick = getMyLoginNick();

    return `
      <div class="page-header">
        <h1><span class="role-badge role-observer">觀察者（不限人數）</span> 各環節觀察與收尾回饋</h1>
        <span class="obs-sig-badge role-observer">✍️ 你的回饋將自動署名：${escapeHtml(myNick)}</span>
      </div>

      <div class="alert alert-info">
        <span>👁️ <strong>觀察者專屬說明：</strong>觀察者人數不限，你可以隨時點選上方頁籤檢視屋主、買方、買賣仲介與店長的所有細節。你在下方填寫的「每個環節觀察」與「結束回饋問題」都會<strong>自動加上你的登入暱稱（${escapeHtml(
          myNick
        )}）即時同步在網頁中</strong>；若同一題或同一環節超過 3 則回饋，第 4 則起會自動收合進子夾，點開即可查看！</span>
      </div>

      ${renderQuickRolePeekBar("觀察者")}
      ${renderLiveTableCard()}
      ${renderAgentsSyncOverviewCard()}

      <!-- 1. 觀察檢核表（做到就打勾） -->
      <div class="card">
        <div class="card-title">
          <span>☑️ 1. 觀察檢核表（做到就打勾・自動同步）</span>
          <span class="obs-sig-badge role-observer">✍️ 署名：${escapeHtml(myNick)}</span>
        </div>
        <div class="form-grid">
          <div>
            <h3 style="font-size:0.96rem;margin-bottom:8px;"><span class="role-badge role-sagent">賣方仲介 6 項</span></h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${M.s_checks
                .map(
                  (c, i) => `
                <label class="task-check-label">
                  <input type="checkbox" class="chk-obs-s" data-idx="${i}" ${oNotes.s_checks[i] ? "checked" : ""} />
                  <span>${escapeHtml(c)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>
          <div>
            <h3 style="font-size:0.96rem;margin-bottom:8px;"><span class="role-badge role-bagent">買方仲介 6 項</span></h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${M.b_checks
                .map(
                  (c, i) => `
                <label class="task-check-label">
                  <input type="checkbox" class="chk-obs-b" data-idx="${i}" ${oNotes.b_checks[i] ? "checked" : ""} />
                  <span>${escapeHtml(c)}</span>
                </label>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 每個環節觀察到的事情 -->
      <div class="card">
        <div class="card-title">
          <span>🔎 2. 每個環節你觀察到的事情（輸入即同步・具名：${escapeHtml(myNick)}）</span>
          <span style="font-size:0.84rem;color:var(--muted);">超過 3 人填寫時將自動收合至子夾</span>
        </div>
        <div class="form-grid">
          ${OBSERVER_STAGES.map(
            (st) => `
            <div>
              <label class="field-label">${escapeHtml(st.title)}</label>
              <textarea class="inp-obs-stage" data-stage="${st.key}" placeholder="${escapeHtml(st.placeholder)}">${escapeHtml(
              (oNotes.stages && oNotes.stages[st.key]) || ""
            )}</textarea>
            </div>`
          ).join("")}
        </div>
      </div>

      <!-- 3. 結束時的回饋問題 -->
      <div class="card">
        <div class="card-title">
          <span>💬 3. 遊戲結束時的回饋問題（輸入即同步・具名：${escapeHtml(myNick)}）</span>
          <span style="font-size:0.84rem;color:var(--muted);">超過 3 人填寫時將自動收合至子夾</span>
        </div>
        <div class="form-grid">
          ${OBSERVER_FB_QUESTIONS.map(
            (q) => `
            <div>
              <label class="field-label">${escapeHtml(q.title)}</label>
              <textarea class="inp-obs-fb" data-fb="${q.key}" placeholder="${escapeHtml(q.placeholder)}">${escapeHtml(
              oNotes[q.key] || ""
            )}</textarea>
            </div>`
          ).join("")}
        </div>
      </div>

      <!-- 4. 全場觀察者＆店長回饋同步看板 -->
      <div id="synced-observers-board">
        ${renderSyncedObserversBoardInner()}
      </div>
    `;
  }

  function bindObserverEvents() {
    if (!state.notes.observer) {
      state.notes.observer = createDefaultObserverNotes();
    }
    const oNotes = state.notes.observer;

    document.querySelectorAll(".chk-obs-s").forEach((chk) => {
      chk.addEventListener("change", () => {
        oNotes.s_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
        syncMyObserverRecord("observer", true);
      });
    });

    document.querySelectorAll(".chk-obs-b").forEach((chk) => {
      chk.addEventListener("change", () => {
        oNotes.b_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
        syncMyObserverRecord("observer", true);
      });
    });

    document.querySelectorAll(".inp-obs-stage").forEach((el) => {
      el.addEventListener("input", () => {
        const sKey = el.getAttribute("data-stage");
        if (!oNotes.stages) oNotes.stages = { stage1: "", stage2: "", stage3: "", stage4: "" };
        oNotes.stages[sKey] = el.value;
        saveNotes();
        syncMyObserverRecord("observer", true);
      });
    });

    document.querySelectorAll(".inp-obs-fb").forEach((el) => {
      el.addEventListener("input", () => {
        const fKey = el.getAttribute("data-fb");
        oNotes[fKey] = el.value;
        saveNotes();
        syncMyObserverRecord("observer", true);
      });
    });
  }

  // ==================== 5.6 議價看板（公開） ====================
  function renderBoardPage() {
    const bd = getBoardSeries();
    const xLabels = ["起點", "第一輪", "第二輪", "最後一步"];

    const askVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.ask) || 2200;
    const offerVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.offer) || 1800;
    const targetVal = (CONTENT && CONTENT.CASE && CONTENT.CASE.target) || 2000;

    // 計算折線圖 SVG 座標（Y 軸範圍依劇本動態計算）
    const svgW = 720;
    const svgH = 300;
    const padL = 65;
    const padR = 40;
    const padT = 30;
    const padB = 45;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const minY = offerVal - 50;
    const maxY = askVal + 50;
    const yTicks = [offerVal, offerVal + 100, targetVal, askVal - 100, askVal];

    const getX = (i) => padL + (plotW * i) / 3;
    const getY = (val) => {
      const clamped = Math.max(minY, Math.min(maxY, val));
      return padT + plotH - ((clamped - minY) / (maxY - minY)) * plotH;
    };

    const sPoints = bd.sPrices.slice(0, bd.lastValidIdx + 1).map((p, i) => `${getX(i)},${getY(p)}`).join(" ");
    const bPoints = bd.bPrices.slice(0, bd.lastValidIdx + 1).map((p, i) => `${getX(i)},${getY(p)}`).join(" ");

    return `
      <div class="page-header">
        <h1>📈 議價看板｜雙方價格收斂圖</h1>
        <span class="page-subtitle">起點：屋主開價 ${formatNum(askVal)} 萬 vs 買方斡旋 ${formatNum(offerVal)} 萬（價差 ${formatNum(askVal - offerVal)} 萬）</span>
      </div>

      <!-- 狀態列（7.2 節） -->
      <div class="alert ${bd.statusClass}" id="board-status-banner">
        <span>📣 ${escapeHtml(bd.statusText)}</span>
      </div>

      <!-- 折線圖 -->
      <div class="card">
        <div class="card-title">
          <span>價格收斂折線圖</span>
          <div style="display:flex;gap:14px;font-size:0.86rem;">
            <span><span class="role-dot" style="background:#9B2A1F"></span> 屋主開價／讓價</span>
            <span><span class="role-dot" style="background:#2F5D62"></span> 買方出價／加價</span>
          </div>
        </div>
        <div class="chart-box">
          <svg viewBox="0 0 ${svgW} ${svgH}" class="chart-svg" role="img" aria-label="議價收斂折線圖">
            <!-- 水平網格線 -->
            ${yTicks
              .map((yVal) => {
                const y = getY(yVal);
                return `
                  <line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}"
                    stroke="#E5DEC9"
                    stroke-width="1" />
                  <text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="12" font-weight="700" fill="#5C4B3B">${yVal}</text>
                `;
              })
              .join("")}

            <!-- X 軸標籤 -->
            ${xLabels
              .map((lbl, i) => {
                const x = getX(i);
                return `
                  <line x1="${x}" y1="${padT}" x2="${x}" y2="${svgH - padB}" stroke="#F0EAE1" stroke-width="1" />
                  <text x="${x}" y="${svgH - 14}" text-anchor="middle" font-size="13" font-weight="900" fill="#3B2F25">${lbl}</text>
                `;
              })
              .join("")}

            <!-- 屋主折線（磚紅） -->
            <polyline fill="none" stroke="#9B2A1F" stroke-width="3.5" points="${sPoints}" />
            ${bd.sPrices
              .slice(0, bd.lastValidIdx + 1)
              .map((p, i) => {
                const x = getX(i);
                const y = getY(p);
                return `
                  <circle cx="${x}" cy="${y}" r="5.5" fill="#9B2A1F" stroke="#FFF" stroke-width="2" />
                  <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="12" font-weight="900" fill="#9B2A1F">${p}</text>
                `;
              })
              .join("")}

            <!-- 買方折線（深青） -->
            <polyline fill="none" stroke="#2F5D62" stroke-width="3.5" points="${bPoints}" />
            ${bd.bPrices
              .slice(0, bd.lastValidIdx + 1)
              .map((p, i) => {
                const x = getX(i);
                const y = getY(p);
                return `
                  <circle cx="${x}" cy="${y}" r="5.5" fill="#2F5D62" stroke="#FFF" stroke-width="2" />
                  <text x="${x}" y="${y + 20}" text-anchor="middle" font-size="12" font-weight="900" fill="#2F5D62">${p}</text>
                `;
              })
              .join("")}
          </svg>
        </div>
      </div>

      <!-- 各輪數字與條件明細表 -->
      <div class="card">
        <div class="card-title">
          <span>各輪出價與條件一覽</span>
          <span style="font-size:0.84rem;color:var(--muted);">
            ${bd.useRoom ? "📡 自動同步自房間內屋主與買方填寫資料" : "✏️ 單機未進房模式：可直接於下方手動輸入試算"}
          </span>
        </div>

        <table class="resp-table">
          <thead>
            <tr>
              <th>輪次</th>
              <th>屋主數字（萬）</th>
              <th>屋主要換的條件</th>
              <th>買方數字（萬）</th>
              <th>買方要換的條件</th>
              <th>當輪差距</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label="輪次"><strong>起點</strong></td>
              <td data-label="屋主數字（萬）"><strong class="num" style="color:var(--role-seller);">${formatNum(askVal)}</strong></td>
              <td data-label="屋主要換的條件">—</td>
              <td data-label="買方數字（萬）"><strong class="num" style="color:var(--role-buyer);">${formatNum(offerVal)}</strong></td>
              <td data-label="買方要換的條件">—</td>
              <td data-label="當輪差距"><strong class="num">${formatNum(askVal - offerVal)} 萬</strong></td>
            </tr>
            ${ROUND_LABELS.map((rLbl, idx) => {
              const sr = bd.sRounds[idx];
              const br = bd.bRounds[idx];
              const sp = bd.sPrices[idx + 1];
              const bp = bd.bPrices[idx + 1];
              const hasAny = sr.price !== null || br.price !== null;
              const gapText = hasAny ? `${formatNum(sp - bp)} 萬` : "—";

              if (bd.useRoom) {
                return `
                  <tr>
                    <td data-label="輪次"><strong>${escapeHtml(rLbl)}</strong></td>
                    <td data-label="屋主數字（萬）"><strong class="num" style="color:var(--role-seller);">${
                      sr.price !== null ? formatNum(sr.price) : "—"
                    }</strong></td>
                    <td data-label="屋主要換的條件">${escapeHtml(sr.cond || "—")}</td>
                    <td data-label="買方數字（萬）"><strong class="num" style="color:var(--role-buyer);">${
                      br.price !== null ? formatNum(br.price) : "—"
                    }</strong></td>
                    <td data-label="買方要換的條件">${escapeHtml(br.cond || "—")}</td>
                    <td data-label="當輪差距"><strong class="num">${gapText}</strong></td>
                  </tr>
                `;
              } else {
                return `
                  <tr>
                    <td data-label="輪次"><strong>${escapeHtml(rLbl)}</strong></td>
                    <td data-label="屋主數字（萬）">
                      <input type="number" class="inp-board-s-price" data-idx="${idx}" min="0" max="5000" step="10" placeholder="萬" value="${
                        sr.price !== null ? escapeHtml(sr.price) : ""
                      }" />
                    </td>
                    <td data-label="屋主要換的條件">
                      <input type="text" class="inp-board-s-cond" data-idx="${idx}" placeholder="屋主條件" value="${escapeHtml(sr.cond)}" />
                    </td>
                    <td data-label="買方數字（萬）">
                      <input type="number" class="inp-board-b-price" data-idx="${idx}" min="0" max="5000" step="10" placeholder="萬" value="${
                        br.price !== null ? escapeHtml(br.price) : ""
                      }" />
                    </td>
                    <td data-label="買方要換的條件">
                      <input type="text" class="inp-board-b-cond" data-idx="${idx}" placeholder="買方條件" value="${escapeHtml(br.cond)}" />
                    </td>
                    <td data-label="當輪差距"><strong class="num">${gapText}</strong></td>
                  </tr>
                `;
              }
            }).join("")}
          </tbody>
        </table>
      </div>

      ${
        isGameEnded() || state.role === "manager" || state.role === "observer"
          ? renderQuickRolePeekBar(isGameEnded() ? "成交結束・全體" : state.role === "manager" ? "店長" : "觀察者") +
            renderAgentsSyncOverviewCard()
          : ""
      }

      <div id="synced-observers-board">
        ${renderSyncedObserversBoardInner()}
      </div>
    `;
  }

  function bindBoardEvents() {
    document.querySelectorAll(".inp-board-s-price").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.notes.manualBoard.seller[Number(inp.getAttribute("data-idx"))].price = inp.value;
        saveNotes();
        renderAll();
      });
    });
    document.querySelectorAll(".inp-board-s-cond").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.notes.manualBoard.seller[Number(inp.getAttribute("data-idx"))].cond = inp.value;
        saveNotes();
        renderAll();
      });
    });
    document.querySelectorAll(".inp-board-b-price").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.notes.manualBoard.buyer[Number(inp.getAttribute("data-idx"))].price = inp.value;
        saveNotes();
        renderAll();
      });
    });
    document.querySelectorAll(".inp-board-b-cond").forEach((inp) => {
      inp.addEventListener("change", () => {
        state.notes.manualBoard.buyer[Number(inp.getAttribute("data-idx"))].cond = inp.value;
        saveNotes();
        renderAll();
      });
    });
  }

  // ==================== 5.7 共用工具（複製、下載列印版、清空重來） ====================
  function buildSummaryText() {
    const lines = [];
    const scTitle = CONTENT && CONTENT.CASE && CONTENT.CASE.title ? CONTENT.CASE.title : "實戰斡旋";
    lines.push(`【談判小房間｜${scTitle}｜演練紀錄】`);
    lines.push(`房間代碼：${state.roomCode || "單機"} ｜ 劇本：${scTitle} ｜ 暱稱：${state.nick || "未填"} ｜ 角色：${state.role}`);
    lines.push("");

    ["seller", "buyer"].forEach((cKey) => {
      const lbl = cKey === "seller" ? "屋主" : "買方";
      lines.push(`■ ${lbl}各輪回應：`);
      ROUND_LABELS.forEach((rLbl, idx) => {
        const r = state.roomData.clients[cKey].rounds[String(idx)] || {};
        lines.push(`  - ${rLbl}：${r.price !== null && r.price !== undefined ? r.price + " 萬" : "未填"} ／ 條件：${r.cond || "無"}`);
      });
      lines.push("");
    });

    ["sagent", "bagent"].forEach((aKey) => {
      const A = aKey === "sagent" ? CONTENT.SAGENT : CONTENT.BAGENT;
      const n = getSyncedAgentNotes(aKey);
      const hist = getAgentMessageHistory(aKey);
      lines.push(`■ ${A.name}筆記與傳話紀錄：`);
      if (hist.length > 0) {
        hist.forEach((h, i) => {
          lines.push(
            `  - 傳話紀錄 #${i + 1}（${h.roundLabel || "第一輪"}）：帶過去 ${
              h.offer !== null && h.offer !== undefined ? h.offer + " 萬" : "未填"
            }｜傳話：${h.intel || "無"}`
          );
        });
      }
      A.explore.forEach((ex, i) => {
        if (n.explore[i]) lines.push(`  - ${ex[0]}：${n.explore[i]}`);
      });
      n.ladder.forEach((l, i) => {
        if (l.price || l.arg || l.cond) {
          lines.push(
            `  - 階梯[${A.ladder[i][0]}]：${l.price || "—"} 萬｜柱子：${(l.pillars || []).join("、") || "無"}｜論述：${
              l.arg || "無"
            }｜換條件：${l.cond || "無"}`
          );
        }
      });
      lines.push("");
    });

    const obsList = getCollectedObserversList();
    if (obsList.length > 0) {
      lines.push("■ 觀察者與店長具名回饋：");
      obsList.forEach((o) => {
        const roleTitle = o.role === "manager" ? "店長" : "觀察者";
        lines.push(`  【署名：${o.nick}（${roleTitle}）】`);
        OBSERVER_STAGES.forEach((st) => {
          const txt = o.stages && o.stages[st.key];
          if (txt) lines.push(`    - ${st.title}：${txt}`);
        });
        OBSERVER_FB_QUESTIONS.forEach((q) => {
          const txt = o[q.key];
          if (txt) lines.push(`    - ${q.title}：${txt}`);
        });
      });
      lines.push("");
    }

    return lines.join("\n");
  }

  function initSharedToolbar() {
    const btnCopy = document.getElementById("btn-copy-notes");
    const btnDownload = document.getElementById("btn-download-html");
    const btnReset = document.getElementById("btn-reset-all");

    btnCopy.addEventListener("click", () => {
      const text = buildSummaryText();
      navigator.clipboard.writeText(text).then(() => {
        const orig = btnCopy.textContent;
        btnCopy.textContent = "✅ 已複製到剪貼簿";
        setTimeout(() => (btnCopy.textContent = orig), 1800);
      });
    });

    btnDownload.addEventListener("click", () => {
      const summary = escapeHtml(buildSummaryText());
      const htmlContent = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>談判小房間｜可列印演練紀錄</title>
<style>
  body { font-family: "Noto Sans TC", sans-serif; padding: 32px; color: #3B2F25; line-height: 1.6; }
  h1 { border-bottom: 2px solid #8B6A45; padding-bottom: 8px; }
  pre { background: #F4EFE6; padding: 18px; border-radius: 8px; white-space: pre-wrap; font-family: inherit; }
</style>
</head>
<body>
  <h1>談判小房間｜可列印演練紀錄</h1>
  <pre>${summary}</pre>
  <script>window.onload = function(){ window.print(); };<\/script>
</body>
</html>`;
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jingmei-record-${state.roomCode || "local"}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // 清空重來：按兩次確認；清空筆記和牌組，但保留房間、暱稱、角色
    btnReset.addEventListener("click", () => {
      const now = Date.now();
      if (now > state.resetConfirmUntil) {
        state.resetConfirmUntil = now + 4000;
        btnReset.textContent = "⚠️ 再按一次確認清空";
        setTimeout(() => {
          if (Date.now() >= state.resetConfirmUntil) {
            btnReset.textContent = "🗑️ 清空重來";
          }
        }, 4100);
        return;
      }

      state.resetConfirmUntil = 0;
      btnReset.textContent = "🗑️ 清空重來";
      state.notes = createDefaultNotes();
      saveNotes();
      state.previewCardIdx = { seller: null, buyer: null };
      state.agentDraft = {
        sagent: { offer: "", intel: "", currentDraftId: null },
        bagent: { offer: "", intel: "", currentDraftId: null }
      };
      state.revealSellerRole = false;
      state.revealBuyerRole = false;

      const resetStamp = Date.now();
      if (state.roomCode) {
        writeRoomPatch("meta/resetId", resetStamp, true);
        writeRoomPatch("clients/seller", createEmptyClientNode(), true);
        writeRoomPatch("clients/buyer", createEmptyClientNode(), true);
        writeRoomPatch("agents/sagent", createEmptyAgentNode(), true);
        writeRoomPatch("agents/bagent", createEmptyAgentNode(), true);
        writeRoomPatch("manager", { started: false, round: 0, deal: null, by: null, updatedAt: resetStamp }, true);
        writeRoomPatch("observers", {});
      } else {
        state.roomData = createEmptyRoomData();
      }
      renderAll();
    });
  }

  // ==================== 路由與啟動 ====================
  function handleHashChange() {
    const rawHash = (window.location.hash || "#room").replace(/^#/, "");
    const validTab = TABS.some((t) => t.id === rawHash) ? rawHash : "room";
    if (!canAccessTab(validTab)) {
      const roleObj = ROLES.find((r) => r.id === state.role);
      const myRoleName = roleObj ? roleObj.short : state.role;
      showLockToast(
        `🔒 遊戲進行中，除「店長」與「觀察者」外，你（${myRoleName}）目前只能查看自己的頁籤；待店長按下「宣布成交」結束遊戲後，即可查看所有人的細節！`
      );
      const fallbackTab = canAccessTab(state.tab) ? state.tab : canAccessTab(state.role) ? state.role : "room";
      state.tab = fallbackTab;
      try {
        history.replaceState(null, "", `#${fallbackTab}`);
      } catch (e) {}
      renderAll();
      return;
    }
    if (state.tab !== validTab) {
      // 切換分頁自動蓋回秘密角色卡（第 5.3 節）
      state.revealSellerRole = false;
      state.revealBuyerRole = false;
    }
    state.tab = validTab;
    renderAll();
  }

  function bootstrap() {
    loadSession();
    initSharedToolbar();
    window.addEventListener("hashchange", handleHashChange);

    fetch("./content.json")
      .then((res) => res.json())
      .then((data) => {
        initScenarios(data);
        handleHashChange();
        initSyncEngine();
      })
      .catch((err) => {
        if (window.DEFAULT_CONTENT) {
          initScenarios(window.DEFAULT_CONTENT);
          handleHashChange();
          initSyncEngine();
        } else {
          console.error("載入 content.json 失敗：", err);
        }
      });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
