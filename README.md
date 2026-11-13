# 談判小房間｜公開多人連線版

> **未來仲介研究所｜房仲實戰學院・第四堂 PART 5 完整演練**  
> 免登入、點開連結輸入組別代碼（例如 `a1`）即可 5 人同組即時同步演練。
>
> 🌐 **公開正式網址**：https://dennis76198.github.io/jingmei-negotiation-game/  
> 🔗 **第 1 組快速進房連結範例**：https://dennis76198.github.io/jingmei-negotiation-game/?room=a1

---

## 📁 檔案結構

```text
談判小房間/
├── index.html                  # 單頁應用程式主畫面（含 9 個分頁與響應式介面）
├── styles.css                  # 品牌配色與手機版（≤760px）單欄自適應樣式
├── app.js                      # 遊戲核心邏輯、Firebase 即時同步、價格階梯檢查與議價看板折線圖
├── content.json                # 唯一卡片文字來源（嚴格依規格第 9 節建立）
├── firebase-config.example.js  # Firebase 設定檔範本
├── firebase-config.js          # 實際讀取的設定檔（未填入金鑰前自動以「單機／本機跨視窗測試模式」運作）
├── database.rules.json         # Firebase Realtime Database 安全規則
├── firebase.json               # Firebase Hosting 與 Database 部署設定
└── README.md                   # 本說明文件
```

---

## 一、建立 Firebase 專案與開啟即時同步（約 5 分鐘）

本遊戲使用 **Firebase Realtime Database** 同步房間狀態，並搭配 **Anonymous Auth（匿名驗證）**，讓學員**完全不需要登入任何帳號**就能連線。

### 步驟 1：建立 Firebase 專案
1. 前往 [Firebase Console](https://console.firebase.google.com/) 並登入 Google 帳號。
2. 點選 **「新增專案（Create a project）」**，輸入專案名稱（例如 `jingmei-negotiation-game`），Google Analytics 可關閉，按建立。

### 步驟 2：開啟 Anonymous Auth（匿名登入）
1. 在左側選單點選 **「Build（建置）」→「Authentication」**，按 **「Get started（開始使用）」**。
2. 切換到 **「Sign-in method（登入方式）」** 分頁。
3. 點選 **「Anonymous（匿名）」** → 將開關切換為 **「啟用（Enable）」** → 按 **「儲存（Save）」**。
   *(啟用後，網頁會在背景自動取得匿名憑證，學員完全不會看到任何登入畫面。)*

### 步驟 3：建立 Realtime Database 與貼上安全規則
1. 在左側選單點選 **「Build（建置）」→「Realtime Database」**，按 **「Create Database（建立資料庫）」**。
2. 資料庫位置建議選擇 **Singapore（`asia-southeast1`）** 或 **United States（`us-central1`）**，點下一步。
3. 安全性規則先選「鎖定模式（Locked mode）」建立，建立完成後點選上方 **「Rules（規則）」** 分頁，將內容替換為以下 JSON 並按 **「Publish（發布）」**：

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": "auth != null",
        ".write": "auth != null",
        ".validate": "$room.matches(/^[a-z0-9-]{2,12}$/)"
      }
    }
  }
}
```

---

## 二、把設定貼進 `firebase-config.js`

1. 在 Firebase Console 左上角點選 **⚙️「專案設定（Project settings）」**。
2. 往下滑到「您的應用程式（Your apps）」，點選 **`</>`（網頁 Web）** 圖示。
3. 輸入應用程式暱稱（例如 `jingmei-web`），按「註冊應用程式」。
4. 複製畫面上的 `firebaseConfig` 物件內容，打開本專案的 **`firebase-config.js`** 貼上：

```javascript
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "你的專案ID.firebaseapp.com",
  databaseURL: "https://你的專案ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "你的專案ID",
  storageBucket: "你的專案ID.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

> 💡 **尚未設定 Firebase 前也能測試**：只要 `firebase-config.js` 維持預設的 `YOUR_API_KEY`，系統會自動進入「單機模式」，並啟用同機跨分頁同步（`BroadcastChannel` + `localStorage`），讓你直接在自己的電腦開多個分頁就能測試完整 5 人連線流程！

---

## 三、把網站部署上線（四選一，全部免費）

因為這是純靜態網頁（HTML／CSS／JS／JSON），不需任何後端伺服器，你可以任選以下最順手的方式放上網路：

### 方案 A：Netlify Drop（最簡單，免裝工具、拖拉上線 30 秒搞定）
1. 前往 [https://app.netlify.com/drop](https://app.netlify.com/drop)（免費註冊／登入）。
2. 直接把整個 **`談判小房間` 資料夾** 拖曳進網頁上的虛線框。
3. 幾秒鐘後就會產生一組公開網址（例如 `https://xxxx.netlify.app`），可至 Site configuration → Change site name 改成好記的名稱（例如 `https://jingmei-game.netlify.app`）。

### 方案 B：Vercel
1. 安裝 Vercel CLI（或把資料夾推上 GitHub 後匯入 Vercel）：
   ```bash
   cd "/Users/dennis/AI/AI-Notes/談判小房間"
   npx vercel --prod
   ```
2. 依照提示按 Enter，即可拿到公開網址 `https://xxx.vercel.app`。

### 方案 C：Firebase Hosting
1. 在終端機執行：
   ```bash
   cd "/Users/dennis/AI/AI-Notes/談判小房間"
   npx firebase-tools login
   npx firebase-tools use --add   # 選擇你剛建立的 Firebase 專案
   npx firebase-tools deploy
   ```
2. 這會同時把網站部署到 `https://你的專案ID.web.app` 並自動套用 `database.rules.json`。

### 方案 D：GitHub Pages
1. 將本資料夾內容推送到一個 GitHub Repository。
2. 到該 Repo 的 **Settings → Pages**，在 Build and deployment 選擇 `Deploy from a branch`（`main` / `/ (root)`）並按 Save。
3. 1 分鐘後即可透過 `https://你的帳號.github.io/Repo名稱/` 公開連線。

---

## 四、上課怎麼用（講師與助教指南）

1. **分組與代碼**：
   - 將學員每 **5 人分一組**，給每組一個簡短代碼（例如第 1 組 `a1`、第 2 組 `a2`、第 3 組 `a3`）。
   - 人數不足時：**4 人**由講師或助教兼任店長；**3 人**由一位業務同時扮演「賣方仲介＋買方仲介」（先對買方、再對屋主）。
2. **一鍵進房（連結或 QR Code）**：
   - 第一位進房的同學輸入代碼 `a1` 加入後，頁面下方會自動產生專屬連結（`https://網址/?room=a1`）與 **QR Code**。
   - 同組其他 4 人只要掃描該 QR Code 或點開連結，代碼就會自動帶入。
3. **分配五個角色**：
   - **屋主（林家）**：看「屋主」秘密頁，每輪抽反應卡演出來，並點選／輸入本輪說的數字與條件。
   - **買方（陳家）**：看「買方」秘密頁，同上。
   - **賣方仲介**：看「賣方仲介」頁，訪談屋主、排價格階梯（系統會自動檢查方向與遞減幅度）、與買方仲介即時傳話。
   - **買方仲介**：看「買方仲介」頁，訪談買方、鎖門與 If 條件句、排價格階梯、與賣方仲介即時傳話。
   - **店長／觀察員**：看「店長」頁，切換輪次（第一輪 → 第二輪 → 最後一步）、觀看雙方完整反應卡、勾選觀察表，並在最後一步出面促成後按下 **「宣布成交」**（全組畫面會同步跳出綠色成交橫幅）。
4. **個資提醒**：
   - 這是公開免登入的課堂演練工具，知道房間代碼的人皆可進入該房間，**請提醒學員與講師切勿在遊戲欄位中填寫真實客戶個資**。

