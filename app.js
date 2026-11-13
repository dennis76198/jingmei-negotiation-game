(function () {
  "use strict";

  // 內建預設卡片資料（與 content.json 完全一致，確保 file:// 直接開也能運作，並同時支援 fetch('./content.json')）
  let CONTENT = null;

  const ROLES = [
    { id: "seller", name: "屋主（林家）", short: "屋主", colorClass: "role-seller", color: "#9B2A1F" },
    { id: "buyer", name: "買方（陳家）", short: "買方", colorClass: "role-buyer", color: "#2F5D62" },
    { id: "sagent", name: "賣方仲介", short: "賣方仲介", colorClass: "role-sagent", color: "#8B6A45" },
    { id: "bagent", name: "買方仲介", short: "買方仲介", colorClass: "role-bagent", color: "#5E6B34" },
    { id: "manager", name: "店長／觀察員", short: "店長", colorClass: "role-manager", color: "#4A3B2E" }
  ];

  const TABS = [
    { id: "room", label: "房間" },
    { id: "rules", label: "說明" },
    { id: "case", label: "情境" },
    { id: "seller", label: "屋主", dot: "#9B2A1F" },
    { id: "buyer", label: "買方", dot: "#2F5D62" },
    { id: "sagent", label: "賣方仲介", dot: "#8B6A45" },
    { id: "bagent", label: "買方仲介", dot: "#5E6B34" },
    { id: "manager", label: "店長", dot: "#4A3B2E" },
    { id: "board", label: "議價看板" }
  ];

  const ROUND_LABELS = ["第一輪", "第二輪", "最後一步"];

  const LS_SESSION_KEY = "jingmei_session_v1";
  const LS_NOTES_KEY = "jingmei_notes_v1";
  const LS_LOCAL_ROOMS_KEY = "jingmei_local_rooms_v1";

  // 狀態
  let state = {
    tab: "room",
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
    resetConfirmUntil: 0,
    roomData: createEmptyRoomData(),
    notes: loadNotes()
  };

  let db = null;
  let roomRef = null;
  let connectedRef = null;
  let bc = null;
  let mqttClient = null;
  let mqttConnected = false;
  let currentMqttTopic = null;

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

  function createEmptyRoomData() {
    return {
      meta: { createdAt: Date.now(), updatedAt: Date.now() },
      players: {},
      manager: { round: 0, deal: null, by: null },
      clients: {
        seller: createEmptyClientNode(),
        buyer: createEmptyClientNode()
      },
      agents: {
        sagent: { intel: "", offer: null, by: null },
        bagent: { intel: "", offer: null, by: null }
      }
    };
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
        { price: "2000", pillars: [], arg: "", cond: "", next: "" },
        { price: "", pillars: [], arg: "", cond: "", next: "" }
      ],
      logs: [
        { card: "", price: "", reply: "", cond: "" },
        { card: "", price: "", reply: "", cond: "" },
        { card: "", price: "", reply: "", cond: "" }
      ]
    };
  }

  function createDefaultNotes() {
    return {
      sagent: createDefaultAgentNotes(),
      bagent: createDefaultAgentNotes(),
      manager: {
        s_checks: [false, false, false, false, false, false],
        b_checks: [false, false, false, false, false, false],
        dealNote: "",
        fb1: "",
        fb2: "",
        fb3: ""
      },
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

  function loadNotes() {
    try {
      const raw = localStorage.getItem(LS_NOTES_KEY);
      if (!raw) return createDefaultNotes();
      const parsed = JSON.parse(raw);
      const def = createDefaultNotes();
      return Object.assign(def, parsed);
    } catch (e) {
      return createDefaultNotes();
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(LS_NOTES_KEY, JSON.stringify(state.notes));
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
        if (s.nick) state.nick = String(s.nick).slice(0, 20);
        if (s.roomCode) state.roomCode = normalizeRoomCode(s.roomCode);
        if (s.role && ROLES.some((r) => r.id === s.role)) state.role = s.role;
        if (s.joined && state.roomCode && state.nick) {
          state.joined = true;
        }
      }
    } catch (e) {}

    // 檢查網址 ?room= 參數
    const params = new URLSearchParams(window.location.search);
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

  function normalizeRoomData(raw) {
    const base = createEmptyRoomData();
    if (!raw || typeof raw !== "object") return base;
    if (raw.meta) base.meta = Object.assign(base.meta, raw.meta);
    if (raw.players && typeof raw.players === "object") base.players = raw.players;
    if (raw.manager && typeof raw.manager === "object") {
      base.manager = {
        round: raw.manager.round !== undefined && raw.manager.round !== null ? Number(raw.manager.round) : 0,
        deal: raw.manager.deal !== undefined && raw.manager.deal !== null ? Number(raw.manager.deal) : null,
        by: raw.manager.by || null
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
            // 若 Firebase 因空陣列移除 left，依 drawn 推算是否抽完或全新
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
        base.agents[aKey] = {
          intel: src.intel ? String(src.intel) : "",
          offer: src.offer !== undefined && src.offer !== null && src.offer !== "" ? Number(src.offer) : null,
          by: src.by || null
        };
      }
    });
    return base;
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
    state.roomData = normalizeRoomData(all[code]);
  }

  function saveLocalRoom(code) {
    try {
      const all = getAllLocalRooms();
      state.roomData.meta.updatedAt = Date.now();
      all[code] = state.roomData;
      localStorage.setItem(LS_LOCAL_ROOMS_KEY, JSON.stringify(all));
      if (bc) bc.postMessage({ roomCode: code, t: Date.now() });
      publishMqttRoomState();
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
          // 合併雲端狀態並保留本機在線狀態
          const merged = normalizeRoomData(incoming);
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
      // 訂閱後稍等 350ms 接收保留訊息，再廣播自己的在線狀態
      setTimeout(() => {
        if (state.joined && state.roomCode === code) {
          markLocalPlayerOnline(true);
        }
      }, 350);
    });
  }

  function publishMqttRoomState() {
    if (!mqttClient || !mqttConnected || !state.roomCode) return;
    try {
      const topic = `jingmei-clarity-2026/rooms/${state.roomCode}`;
      mqttClient.publish(topic, JSON.stringify(state.roomData), { qos: 0, retain: true });
    } catch (e) {}
  }

  function markLocalPlayerOnline(online) {
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
    saveLocalRoom(state.roomCode);
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
    } else {
      markLocalPlayerOnline(true);
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
          state.roomData = normalizeRoomData(val);
        }
        renderAll();
      });
      updatePlayerPresence();
    } else {
      loadLocalRoom(code);
      markLocalPlayerOnline(true);
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
  function writeRoomPatch(pathAfterRoom, value) {
    if (!state.roomCode) return;
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
      renderAll();
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
  function checkAgentLadder(agentKey) {
    const isUp = agentKey === "sagent";
    const notes = state.notes[agentKey];
    const rows = notes.ladder; // [開口, 中繼, 目標(2000), 底線/上限推估]
    const openVal = sanitizePrice(rows[0].price);
    const midVal = sanitizePrice(rows[1].price);
    const targetVal = 2000;
    const estVal = sanitizePrice(rows[3].price);

    const results = [];

    // 組裝序列 = [開口, 中繼（有填才算）, 2000]
    const seq = [];
    if (openVal !== null) seq.push({ name: "開口", val: openVal });
    if (midVal !== null) seq.push({ name: "中繼", val: midVal });
    seq.push({ name: "目標", val: targetVal });

    // 方向檢查
    if (seq.length >= 2) {
      let dirOk = true;
      for (let i = 1; i < seq.length; i++) {
        if (isUp && !(seq[i].val > seq[i - 1].val)) dirOk = false;
        if (!isUp && !(seq[i].val < seq[i - 1].val)) dirOk = false;
      }
      if (!dirOk) {
        results.push({
          type: "err",
          tag: "要改",
          text: isUp
            ? "價格階梯方向有誤：賣方仲介請屋主接受的價格，每一步都要大於前一步，一路往上走到 2,000 萬。"
            : "價格階梯方向有誤：買方仲介跟買方要的價格，每一步都要小於前一步，一路往下走到 2,000 萬。"
        });
      } else {
        results.push({
          type: "ok",
          tag: "OK",
          text: `方向正確（${seq.map((s) => formatNum(s.val)).join(" → ")} 萬）`
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
    if (isUp && openVal !== null) {
      if (openVal < 1800) {
        results.push({
          type: "warn",
          tag: "注意",
          text: "注意：開口比買方真實出價還低"
        });
      } else if (openVal > 1800) {
        results.push({
          type: "info",
          tag: "提醒",
          text: "提醒：記得說得出買方那邊為什麼會到這個數字"
        });
      }
    }
    if (!isUp && openVal !== null) {
      if (openVal >= 2200) {
        results.push({
          type: "err",
          tag: "要改",
          text: "要改：開口已經到屋主開價以上，買方不會相信"
        });
      }
    }

    // 柱子／論述與「要換什麼」完整性檢查（有填數字的列，含目標）
    const stepNames = ["開口", "中繼", "目標"];
    const missingPillarOrArg = [];
    const missingCond = [];
    [0, 1, 2].forEach((idx) => {
      const r = rows[idx];
      const hasPrice = idx === 2 || sanitizePrice(r.price) !== null;
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

    // 底線／上限推估檢查
    if (estVal !== null) {
      if (isUp) {
        if (estVal > 2000) {
          results.push({
            type: "warn",
            tag: "注意",
            text: `推估屋主底線 ${formatNum(estVal)} 萬 > 2,000 萬，需要先幫屋主解開心理關卡或條件`
          });
        } else {
          results.push({
            type: "ok",
            tag: "OK",
            text: `底線推估 OK（${formatNum(estVal)} 萬）：2,000 談得成`
          });
        }
      } else {
        if (estVal < 2000) {
          results.push({
            type: "warn",
            tag: "注意",
            text: `推估買方上限 ${formatNum(estVal)} 萬 < 2,000 萬，需確認自備款與八成貸款試算`
          });
        } else {
          results.push({
            type: "ok",
            tag: "OK",
            text: `上限推估 OK（${formatNum(estVal)} 萬）：2,000 談得成`
          });
        }
      }
    }

    return results;
  }

  // 7.2 議價看板資料與狀態
  function getBoardSeries() {
    const useRoom = state.joined || hasAnyRoomClientData();
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

    // 起點 (idx=0): 屋主 2200, 買方 1800
    const sPrices = [2200];
    const bPrices = [1800];
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
      statusText = "起點：屋主開價 2,200 萬、買方斡旋 1,800 萬（還差 400 萬）";
    } else if (sCur === bCur) {
      if (sCur === 2000) {
        statusText = "成交！雙方在 2,000 萬握手";
        statusClass = "alert-ok";
      } else {
        statusText = `雙方在 ${formatNum(sCur)} 萬收斂（遊戲設定是 2,000）`;
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

  function renderAll() {
    if (!CONTENT) return;
    renderStatusBar();
    renderNavTabs();
    renderActiveTab();
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

    roomPill.textContent = state.joined && state.roomCode ? `房間：${state.roomCode}` : "房間：未加入";

    const roleObj = ROLES.find((r) => r.id === state.role);
    const roleName = roleObj ? roleObj.short : "未選擇";
    rolePill.textContent = state.nick ? `${roleName}（${state.nick}）` : `角色：${roleName}`;

    const players = Object.values(state.roomData.players || {});
    const onlineCount = state.joined ? players.filter((p) => p && p.online).length : 0;
    onlinePill.textContent = `在線：${onlineCount} 人`;

    const mRound = state.roomData.manager ? state.roomData.manager.round : 0;
    const roundName = ROUND_LABELS[mRound] || "第一輪";
    roundPill.textContent = `店長輪次：${roundName}`;

    const dealPrice = state.roomData.manager && state.roomData.manager.deal;
    if (dealPrice !== null && dealPrice !== undefined && dealPrice !== "") {
      dealBanner.className = "deal-banner active";
      dealBanner.textContent = `🎉 店長宣布：${formatNum(dealPrice)} 萬成交！`;
    } else {
      dealBanner.className = "deal-banner";
      dealBanner.textContent = "";
    }
  }

  function renderNavTabs() {
    const nav = document.getElementById("nav-tabs");
    nav.innerHTML = TABS.map((t) => {
      const active = state.tab === t.id ? "active" : "";
      const dotHtml = t.dot ? `<span class="role-dot" style="background:${t.dot}"></span>` : "";
      return `<a href="#${t.id}" class="nav-tab ${active}" data-tab="${t.id}">${dotHtml}${escapeHtml(t.label)}</a>`;
    }).join("");
  }

  function renderActiveTab() {
    const container = document.getElementById("app-view");
    switch (state.tab) {
      case "room":
        container.innerHTML = renderRoomPage();
        bindRoomEvents();
        break;
      case "rules":
        container.innerHTML = renderRulesPage();
        break;
      case "case":
        container.innerHTML = renderCasePage();
        break;
      case "seller":
        container.innerHTML = renderClientPage("seller");
        bindClientEvents("seller");
        break;
      case "buyer":
        container.innerHTML = renderClientPage("buyer");
        bindClientEvents("buyer");
        break;
      case "sagent":
        container.innerHTML = renderAgentPage("sagent");
        bindAgentEvents("sagent");
        break;
      case "bagent":
        container.innerHTML = renderAgentPage("bagent");
        bindAgentEvents("bagent");
        break;
      case "manager":
        container.innerHTML = renderManagerPage();
        bindManagerEvents();
        break;
      case "board":
        container.innerHTML = renderBoardPage();
        bindBoardEvents();
        break;
      default:
        container.innerHTML = renderRoomPage();
        bindRoomEvents();
    }
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

    // 檢查重複在線角色
    const duplicateWarnings = [];
    ROLES.forEach((r) => {
      const holders = playersList.filter((p) => p.online && p.role === r.id);
      if (holders.length >= 2) {
        duplicateWarnings.push(`${r.short}有兩個人選，請其中一位換角色`);
      }
    });

    const shareUrl = state.roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.roomCode)}`
      : `${window.location.origin}${window.location.pathname}`;

    return `
      <div class="page-header">
        <h1>談判小房間｜房間設定</h1>
        <span class="page-subtitle">免登入・輸入同組代碼即可多人連線同步</span>
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
        <div class="card-title">1. 輸入組別代碼與你的角色</div>
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
            return `
              <button type="button" class="role-choice-btn ${selected}" data-role="${r.id}">
                <div class="role-choice-top">
                  <span class="role-dot" style="background:${r.color}"></span>
                  <span>${escapeHtml(r.name)}</span>
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

      <div class="card">
        <div class="card-title">
          <span>2. 房間成員清單（${state.joined && state.roomCode ? `代碼：${escapeHtml(state.roomCode)}` : "尚未加入"}）</span>
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
                          <td data-label="角色"><span class="role-badge ${rObj.colorClass}">${escapeHtml(rObj.name)}</span></td>
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
        <div class="card-title">3. 分享房間連結與 QR Code</div>
        <div class="share-box">
          <div class="qr-wrap" id="qr-container" aria-label="房間連結 QR Code"></div>
          <div style="flex:1;min-width:220px;">
            <div class="field-label">同組邀請連結（打開自動帶入組別代碼）</div>
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
    const revealed = isSeller ? state.revealSellerRole : state.revealBuyerRole;
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

    const wrongRoleWarning =
      state.role !== clientKey
        ? `<div class="alert alert-secret">
            <span>🔒 這一頁是${roleLabel}的秘密，請不要偷看（你目前的角色是：${escapeHtml(
              (ROLES.find((r) => r.id === state.role) || {}).name || ""
            )}）</span>
          </div>`
        : "";

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
        <button type="button" id="btn-toggle-role-card" class="btn ${revealed ? "btn-dark" : "btn-primary"}">
          ${revealed ? "🙈 蓋上角色卡" : "🃏 翻開角色卡"}
        </button>
      </div>

      ${wrongRoleWarning}
      ${roundDiffBanner}

      <!-- 角色秘密卡（預設蓋著） -->
      <div class="card">
        <div class="card-title">
          <span>🔒 ${roleLabel}角色卡（秘密設定）</span>
          <span style="font-size:0.84rem;color:var(--muted);">切換分頁會自動蓋回，防旁人誤看</span>
        </div>
        ${
          !revealed
            ? `<div style="text-align:center;padding:24px 12px;background:var(--light-bg);border-radius:8px;">
                <div style="font-weight:900;margin-bottom:10px;color:var(--muted);">角色卡目前已蓋上</div>
                <button type="button" id="btn-toggle-role-card-inner" class="btn btn-primary">🃏 翻開角色卡</button>
              </div>`
            : `
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
    const toggleCard = () => {
      if (isSeller) state.revealSellerRole = !state.revealSellerRole;
      else state.revealBuyerRole = !state.revealBuyerRole;
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
  function renderAgentPage(agentKey) {
    const isSellerAgent = agentKey === "sagent";
    const A = isSellerAgent ? CONTENT.SAGENT : CONTENT.BAGENT;
    const clientKey = isSellerAgent ? "seller" : "buyer";
    const clientLabel = isSellerAgent ? "屋主" : "買方";
    const otherAgentKey = isSellerAgent ? "bagent" : "sagent";
    const otherAgentLabel = isSellerAgent ? "買方仲介" : "賣方仲介";
    const reacts = isSellerAgent ? CONTENT.SELLER_REACT : CONTENT.BUYER_REACT;

    const cNode = state.roomData.clients[clientKey];
    const mySync = state.roomData.agents[agentKey] || { intel: "", offer: null };
    const otherSync = state.roomData.agents[otherAgentKey] || { intel: "", offer: null };
    const notes = state.notes[agentKey];
    const checks = checkAgentLadder(agentKey);

    return `
      <div class="page-header">
        <h1>
          <span class="role-badge ${isSellerAgent ? "role-sagent" : "role-bagent"}">${escapeHtml(A.name)}</span>
          負責：${escapeHtml(A.client)}
        </h1>
        <span class="page-subtitle">${escapeHtml(A.intro)}</span>
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
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;">
            <div class="field-label">📨 ${otherAgentLabel}傳來的話與帶過來的數字</div>
            <div style="font-size:1.05rem;font-weight:900;color:var(--brick);margin-bottom:4px;">
              帶過來的數字：${otherSync.offer !== null && otherSync.offer !== undefined ? formatNum(otherSync.offer) + " 萬" : "尚未傳送"}
            </div>
            <div style="white-space:pre-wrap;font-size:0.93rem;">
              ${otherSync.intel ? escapeHtml(otherSync.intel) : "（尚未傳話）"}
            </div>
          </div>

          <div style="background:var(--light-bg);padding:12px;border-radius:8px;">
            <div class="field-label">📤 傳給${otherAgentLabel}的話（同步給${otherAgentLabel}與店長）</div>
            <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;margin-bottom:8px;">
              <div>
                <input type="number" id="inp-agent-offer" min="0" max="5000" step="10" placeholder="帶過去萬" value="${
                  mySync.offer !== null && mySync.offer !== undefined ? escapeHtml(mySync.offer) : ""
                }" />
              </div>
              <div>
                <input type="text" id="inp-agent-intel" maxlength="300" placeholder="輸入買方/屋主的故事與條件（最多 300 字）" value="${escapeHtml(
                  mySync.intel || ""
                )}" />
              </div>
            </div>
            <button type="button" id="btn-send-agent-sync" class="btn btn-sm btn-primary">同步傳送給${otherAgentLabel}</button>
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
        <div class="card-title">🔍 識局探索（只存在你的裝置，不同步）</div>
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
                      <input type="number" class="inp-ladder-price" data-idx="${idx}" min="0" max="5000" step="10" ${
                        isTarget ? "readonly" : ""
                      } value="${isTarget ? "2000" : escapeHtml(nRow.price)}" />
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
        renderAll();
      });
    });

    // 同步給另一位仲介
    const inpOffer = document.getElementById("inp-agent-offer");
    const inpIntel = document.getElementById("inp-agent-intel");
    const doSyncAgent = () => {
      writeRoomPatch(`agents/${agentKey}`, {
        offer: sanitizePrice(inpOffer.value),
        intel: String(inpIntel.value || "").slice(0, 300),
        by: state.uid
      });
    };
    document.getElementById("btn-send-agent-sync").addEventListener("click", doSyncAgent);
    inpOffer.addEventListener("change", doSyncAgent);
    inpIntel.addEventListener("change", doSyncAgent);

    // 任務勾選
    document.querySelectorAll(".chk-agent-task").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = Number(chk.getAttribute("data-idx"));
        notes.tasks[idx] = chk.checked;
        saveNotes();
      });
    });

    // 識局探索
    document.querySelectorAll(".inp-agent-explore").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.getAttribute("data-idx"));
        notes.explore[idx] = inp.value;
        saveNotes();
      });
    });

    // 交換情報
    document.querySelectorAll(".inp-agent-intel-note").forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = Number(inp.getAttribute("data-idx"));
        notes.intel[idx] = inp.value;
        saveNotes();
      });
    });

    // 看出交集
    document.querySelectorAll(".inp-cross-care").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].care = inp.value;
        saveNotes();
      });
    });
    document.querySelectorAll(".inp-cross-give").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].give = inp.value;
        saveNotes();
      });
    });
    document.querySelectorAll(".inp-cross-hook").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.cross[Number(inp.getAttribute("data-idx"))].hook = inp.value;
        saveNotes();
      });
    });

    // 價格階梯與即時重算檢查
    const refreshLadderChecks = () => {
      saveNotes();
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
        if (idx !== 2) {
          notes.ladder[idx].price = inp.value;
          refreshLadderChecks();
        }
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
      });
    });

    // 回合紀錄
    document.querySelectorAll(".inp-log-card").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].card = inp.value;
        saveNotes();
      });
    });
    document.querySelectorAll(".inp-log-price").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].price = inp.value;
        saveNotes();
      });
    });
    document.querySelectorAll(".inp-log-reply").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].reply = inp.value;
        saveNotes();
      });
    });
    document.querySelectorAll(".inp-log-cond").forEach((inp) => {
      inp.addEventListener("input", () => {
        notes.logs[Number(inp.getAttribute("data-idx"))].cond = inp.value;
        saveNotes();
      });
    });
  }

  // ==================== 5.5 店長頁 ====================
  function renderManagerPage() {
    const M = CONTENT.MANAGER;
    const mRound = state.roomData.manager ? Number(state.roomData.manager.round || 0) : 0;
    const dealVal = state.roomData.manager && state.roomData.manager.deal;
    const sClient = state.roomData.clients.seller;
    const bClient = state.roomData.clients.buyer;
    const sAgent = state.roomData.agents.sagent || { intel: "", offer: null };
    const bAgent = state.roomData.agents.bagent || { intel: "", offer: null };
    const mNotes = state.notes.manager;

    const renderFullCardForManager = (clientKey, cardIdx) => {
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
    };

    return `
      <div class="page-header">
        <h1><span class="role-badge role-manager">店長／觀察員</span> 全場控台與觀察表</h1>
        <div class="round-tabs">
          ${ROUND_LABELS.map(
            (lbl, idx) => `
            <button type="button" class="round-btn btn-manager-round ${mRound === idx ? "active" : ""}" data-round="${idx}">
              切換至：${escapeHtml(lbl)}
            </button>`
          ).join("")}
        </div>
      </div>

      <!-- 即時牌桌（店長看得到兩邊完整反應卡內容） -->
      <div class="card">
        <div class="card-title">👀 即時牌桌（全組同步・店長可看完整反應卡）</div>
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
                    ${renderFullCardForManager("seller", sr.card)}
                  </td>
                  <td data-label="買方">
                    <div style="margin-bottom:6px;">
                      <strong>數字：${br.price !== null && br.price !== undefined ? formatNum(br.price) + " 萬" : "—"}</strong>
                      ｜ 條件：${escapeHtml(br.cond || "—")}
                    </div>
                    ${renderFullCardForManager("buyer", br.card)}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="form-grid">
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;">
            <strong>賣方仲介 → 買方仲介（帶過去：${sAgent.offer !== null && sAgent.offer !== undefined ? formatNum(sAgent.offer) + " 萬" : "—"}）</strong>
            <div style="font-size:0.92rem;margin-top:4px;">${escapeHtml(sAgent.intel || "（尚未傳話）")}</div>
          </div>
          <div style="background:var(--light-bg);padding:12px;border-radius:8px;">
            <strong>買方仲介 → 賣方仲介（帶過去：${bAgent.offer !== null && bAgent.offer !== undefined ? formatNum(bAgent.offer) + " 萬" : "—"}）</strong>
            <div style="font-size:0.92rem;margin-top:4px;">${escapeHtml(bAgent.intel || "（尚未傳話）")}</div>
          </div>
        </div>
      </div>

      <!-- 做到就打勾（兩組各 6 項） -->
      <div class="card">
        <div class="card-title">☑️ 觀察檢核表（做到就打勾）</div>
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

      <!-- 最後一步台詞範例 + 宣布成交 -->
      <div class="card">
        <div class="card-title">🏆 最後一步：店長出面（下黑上白）＆ 宣布成交</div>
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
            <input type="number" id="inp-mgr-deal" min="0" max="5000" step="10" placeholder="2000" value="${
              dealVal !== null && dealVal !== undefined ? escapeHtml(dealVal) : "2000"
            }" />
          </div>
          <button type="button" id="btn-announce-deal" class="btn btn-primary">🎉 宣布成交（全組跳出橫幅）</button>
          ${
            dealVal !== null && dealVal !== undefined
              ? `<button type="button" id="btn-clear-deal" class="btn">收回成交橫幅</button>`
              : ""
          }
        </div>
      </div>

      <!-- 收尾回饋三題 -->
      <div class="card">
        <div class="card-title">💬 收尾回饋三題（10 分鐘）</div>
        <div class="form-grid">
          <div>
            <label class="field-label">1. 客戶回饋：哪一句話讓你真的想讓步？</label>
            <textarea id="inp-mgr-fb1" placeholder="記錄屋主與買方的感受">${escapeHtml(mNotes.fb1 || "")}</textarea>
          </div>
          <div>
            <label class="field-label">2. 哪一步有做到「換條件」？哪一步忘記換？</label>
            <textarea id="inp-mgr-fb2" placeholder="記錄關鍵轉折">${escapeHtml(mNotes.fb2 || "")}</textarea>
          </div>
          <div>
            <label class="field-label">3. 如果重來一次，哪一輪的話術可以更好？</label>
            <textarea id="inp-mgr-fb3" placeholder="店長總結建議">${escapeHtml(mNotes.fb3 || "")}</textarea>
          </div>
        </div>
      </div>
    `;
  }

  function bindManagerEvents() {
    document.querySelectorAll(".btn-manager-round").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = Number(btn.getAttribute("data-round"));
        writeRoomPatch("manager/round", r);
        writeRoomPatch("manager/by", state.uid);
      });
    });

    document.querySelectorAll(".chk-mgr-s").forEach((chk) => {
      chk.addEventListener("change", () => {
        state.notes.manager.s_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
      });
    });
    document.querySelectorAll(".chk-mgr-b").forEach((chk) => {
      chk.addEventListener("change", () => {
        state.notes.manager.b_checks[Number(chk.getAttribute("data-idx"))] = chk.checked;
        saveNotes();
      });
    });

    const inpDeal = document.getElementById("inp-mgr-deal");
    document.getElementById("btn-announce-deal").addEventListener("click", () => {
      const val = sanitizePrice(inpDeal.value);
      if (val !== null) {
        writeRoomPatch("manager/deal", val);
        writeRoomPatch("manager/by", state.uid);
      }
    });
    const btnClearDeal = document.getElementById("btn-clear-deal");
    if (btnClearDeal) {
      btnClearDeal.addEventListener("click", () => {
        writeRoomPatch("manager/deal", null);
      });
    }

    ["fb1", "fb2", "fb3"].forEach((k) => {
      const el = document.getElementById(`inp-mgr-${k}`);
      if (el) {
        el.addEventListener("input", () => {
          state.notes.manager[k] = el.value;
          saveNotes();
        });
      }
    });
  }

  // ==================== 5.6 議價看板（公開） ====================
  function renderBoardPage() {
    const bd = getBoardSeries();
    const xLabels = ["起點", "第一輪", "第二輪", "最後一步"];

    // 計算折線圖 SVG 座標（Y 軸範圍 1750 ~ 2250）
    const svgW = 720;
    const svgH = 300;
    const padL = 65;
    const padR = 40;
    const padT = 30;
    const padB = 45;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const minY = 1750;
    const maxY = 2250;

    const getX = (i) => padL + (plotW * i) / 3;
    const getY = (val) => {
      const clamped = Math.max(minY, Math.min(maxY, val));
      return padT + plotH - ((clamped - minY) / (maxY - minY)) * plotH;
    };

    const sPoints = bd.sPrices.slice(0, bd.lastValidIdx + 1).map((p, i) => `${getX(i)},${getY(p)}`).join(" ");
    const bPoints = bd.bPrices.slice(0, bd.lastValidIdx + 1).map((p, i) => `${getX(i)},${getY(p)}`).join(" ");
    const y2000 = getY(2000);

    return `
      <div class="page-header">
        <h1>📈 議價看板｜雙方價格收斂圖</h1>
        <span class="page-subtitle">起點 2,200 vs 1,800 → 目標 2,000 萬握手</span>
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
            <span style="color:var(--accent);">--- 2,000 萬目標線</span>
          </div>
        </div>
        <div class="chart-box">
          <svg viewBox="0 0 ${svgW} ${svgH}" class="chart-svg" role="img" aria-label="議價收斂折線圖">
            <!-- 水平網格線 -->
            ${[1800, 1900, 2000, 2100, 2200]
              .map((yVal) => {
                const y = getY(yVal);
                const isTarget = yVal === 2000;
                return `
                  <line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}"
                    stroke="${isTarget ? "#8B6A45" : "#E5DEC9"}"
                    stroke-width="${isTarget ? "2" : "1"}"
                    ${isTarget ? 'stroke-dasharray="6,5"' : ""} />
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
              <td data-label="屋主數字（萬）"><strong class="num" style="color:var(--role-seller);">2,200</strong></td>
              <td data-label="屋主要換的條件">—</td>
              <td data-label="買方數字（萬）"><strong class="num" style="color:var(--role-buyer);">1,800</strong></td>
              <td data-label="買方要換的條件">—</td>
              <td data-label="當輪差距"><strong class="num">400 萬</strong></td>
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
    lines.push(`【談判小房間｜演練紀錄】`);
    lines.push(`房間代碼：${state.roomCode || "單機"} ｜ 暱稱：${state.nick || "未填"} ｜ 角色：${state.role}`);
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
      const n = state.notes[aKey];
      lines.push(`■ ${A.name}筆記：`);
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

      if (state.roomCode) {
        writeRoomPatch("clients/seller", createEmptyClientNode());
        writeRoomPatch("clients/buyer", createEmptyClientNode());
        writeRoomPatch("agents/sagent", { intel: "", offer: null, by: null });
        writeRoomPatch("agents/bagent", { intel: "", offer: null, by: null });
        writeRoomPatch("manager", { round: 0, deal: null, by: null });
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
        CONTENT = data;
        handleHashChange();
        initSyncEngine();
      })
      .catch((err) => {
        if (window.DEFAULT_CONTENT) {
          CONTENT = window.DEFAULT_CONTENT;
          handleHashChange();
          initSyncEngine();
        } else {
          console.error("載入 content.json 失敗：", err);
        }
      });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
