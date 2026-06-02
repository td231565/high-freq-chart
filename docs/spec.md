# 高頻圖表 WebSocket 處理 MVP 專案規格書 (SPEC)

本規格書旨在規劃一個最小可行性產品 (MVP)，展示如何在 React/Next.js 環境下，以資深前端工程師的標準處理高頻 WebSocket 數據（如股價、幣價），並在維持 60fps 流暢渲染的同時，將 CPU 與記憶體消耗降至最低。

---

## 1. 核心設計架構 (Core Architecture)

為了徹底解決 React 虛擬 DOM (Virtual DOM) 在面對高頻更新（例如每秒 100 至 1000 筆資料）時的渲染瓶頸，本 MVP 採用以下分層架構：

```mermaid
graph TD
    WS[WebSocket Server / Mock] -->|高頻原始 Tick Data| Worker[Web Worker]
    Worker -->|數據解析、技術指標計算| CB[Circular Buffer 環狀緩衝區]
    CB -->|定時批次數據推送| Hook[React Custom Hook: useHighFrequencyData]
    Hook -->|保存最新數據 (不觸發 Render)| Ref[useRef]
    Hook -->|觸發 rAF 循環| RAF[requestAnimationFrame]
    RAF -->|直接操作 Canvas / WebGL| Chart[Lightweight Charts Canvas]
    RAF -->|節流更新特定 DOM (如最新價格)| DOM[Direct DOM Update / Throttled Text]
```

### 核心技術要點

1. **資料與 UI 渲染分離**：WebSocket 接收與資料處理完全運行在 Web Worker 中，避免阻塞主執行緒。
2. **零 React State 儲存高頻資料**：高頻資料不寫入 React state，改用 `useRef` 進行快照式暫存，完全避免 React 元件重繪 (Re-render)。
3. **主動式幀率控制**：使用 `requestAnimationFrame` (rAF) 建立與螢幕刷新率同步的渲染循環，確保每秒最多只重繪 60 次。
4. **記憶體管理 (GC 優化)**：使用固定長度的環狀緩衝區 (Circular Buffer)，重複利用陣列空間，消除高頻分配記憶體造成的垃圾回收 (Garbage Collection) 卡頓。
5. **DOM 節流更新**：對於需要用文字顯示的最新價格，不使用 React state，而是透過 `useRef` 取得 DOM 節點，直接修改 `innerText`，並進行 100ms 節流。

---

## 2. 專案目錄結構 (Directory Structure)

配合 **Bun**、**ESLint v10 (Flat Config)**、**Prettier** 以及 **Tailwind CSS v4** 的新配置，專案目錄結構如下：

```text
high-frequency-chart-mvp/
├── app/
│   ├── globals.css              # 全局 CSS：載入 Tailwind v4 與配置自訂變數
│   ├── layout.tsx
│   └── page.tsx                 # 主畫面：包含圖表、控制面板與效能監控
├── components/
│   ├── PerformanceMonitor.tsx   # 效能監控面板 (FPS, GC, Message/s)
│   └── TradingChart.tsx         # 圖表組件 (基於 lightweight-charts v5.2.0)
├── hooks/
│   └── useHighFrequencyData.ts  # 核心 Hook，管理 Worker 與 rAF 渲染循環
├── constants/
│   └── chart.ts                 # 系統常數：心跳、指數退避重連、緩衝容量等
├── lib/
│   └── circular-buffer.ts       # 環狀緩衝區資料結構實作
├── workers/
│   └── data.worker.ts           # Web Worker，處理 WebSocket 連線與數據預處理
├── .prettierrc                  # Prettier 程式碼格式化配置檔
├── eslint.config.mjs            # ESLint v10 扁平配置文件 (Flat Config)
├── tsconfig.json                # TypeScript 設定檔
└── package.json                 # Bun 依賴配置文件
```

---

## 3. 核心程式

### 3.1 環狀緩衝區 (`lib/circular-buffer.ts`)

避免高頻 `push` 和 `shift` 導致陣列重新分配記憶體。

### 3.2 Web Worker 數據處理 (`workers/data.worker.ts`)

在獨立執行緒進行 WebSocket 連線、連線保活與高頻計算。連線相關常數集中定義於 `constants/chart.ts`。

1. **心跳檢測 (Heartbeat)**：連線成功後，每 30 秒向伺服器發送 `PING`；若在 5 秒內未收到任何回應（含 `PONG` 或 Tick 資料），主動關閉 Socket 並進入重連流程。
2. **指數退避重連 (Exponential Backoff)**：連線中斷、建立失敗或心跳逾時時，若使用者未主動斷線，則排程自動重連——首次等待 1 秒，之後每次失敗延遲加倍，上限 30 秒；連線成功後重置為初始 1 秒。
3. **連線狀態回報**：透過 `postMessage` 將 `CONNECTING`、`RECONNECTING`、`CONNECTED`、`DISCONNECTED` 回傳主執行緒；重連嘗試（延遲已大於初始值）時回報 `RECONNECTING`。
4. **手動斷線**：收到 `DISCONNECT` 指令時停止自動重連，關閉 Socket 並清理心跳定時器。

連線參數預設值（可於 `constants/chart.ts` 調整）：

- **心跳發送間隔 (PING_INTERVAL_MS)**：30000 ms（30 秒）
- **心跳逾時判定 (PONG_TIMEOUT_MS)**：5000 ms（5 秒）
- **重連初始延遲 (INITIAL_RECONNECT_DELAY_MS)**：1000 ms（1 秒）
- **重連延遲上限 (MAX_RECONNECT_DELAY_MS)**：30000 ms（30 秒）

### 3.3 核心 React Hook (`hooks/useHighFrequencyData.ts`)

橋接 Web Worker 與 `requestAnimationFrame` 繪圖循環。

### 3.4 圖表與渲染組件 (`components/TradingChart.tsx`)

使用 `requestAnimationFrame` 驅動 `lightweight-charts` 進行高頻繪製。配合 **v5.2.0** API 進行繪製。

---

## 4. 效能評估指標 (Performance Evaluation Metrics)

為了驗證本 MVP 架構是否有效降低渲染負荷，前端應整合檢測機制以監控下列指標：

- **幀率 (FPS)**
  - **預期表現 (資深標準)**：58 - 60 FPS
  - **說明**：UI 渲染幀率必須穩定維持在 60 幀左右，不得出現任何卡頓。
- **JS Heap 記憶體**
  - **預期表現 (資深標準)**：呈鋸齒狀低斜率，無階梯式攀升
  - **說明**：使用環狀緩衝區應能使記憶體維持在穩定區間，避免頻繁的垃圾回收 (GC) 造成微卡頓。
- **CPU 使用率**
  - **預期表現 (資深標準)**：< 10% (主執行緒)
  - **說明**：核心計算已移至 Web Worker，主執行緒只做 Canvas 重繪，CPU 佔用率應保持極低。
- **記憶體漏失防禦**
  - **預期表現 (資深標準)**：0 殘留
  - **說明**：在元件解除安裝 (Unmount) 或分頁切換時，必須完全清除 `requestAnimationFrame` 循環與 `Worker` 實例。
