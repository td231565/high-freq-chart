# 高頻交易圖表 MVP 專案

本專案是一個高效能的高頻交易圖表 MVP（最小可行性產品）實作。旨在展示如何在 React 與 Next.js 環境下，以極低的 CPU 與記憶體開銷處理高頻 WebSocket 數據（例如每秒推送 100 次的價格 Tick），並維持 60 FPS 的流暢渲染。

本專案採用資料處理與渲染分離的核心架構，將高頻 WebSocket 資料接收與環狀緩衝計算移至背景 Web Worker 執行。主執行緒則透過 requestAnimationFrame (rAF) 動態更新 Lightweight Charts 的 Canvas 繪圖區，並直接以 React Ref 操作 DOM 節點進行最新價格的節流更新，徹底避免 React 元件頻繁重繪造成的效能瓶頸。

## 技術棧 (Tech Stack)

以下為本專案鎖定使用的核心技術與依賴版號：

- 執行與套件管理工具：Bun (版本大於等於 1.3.x)
- 前端核心框架：Next.js (版本 16.2.6)
- 渲染引擎與 UI 庫：React (版本 19.0.0) 與 React DOM (版本 19.0.0)
- 高頻圖表庫：Lightweight Charts (版本 5.2.0)
- 樣式配置：Tailwind CSS (版本 4.3.0) 與 PostCSS (版本 8.5.1)
- 程式碼品質與格式化工具：
  - TypeScript (版本 6.0.3)
  - ESLint (版本 10.4.1，採用扁平配置 Flat Config 規格)
  - Prettier (版本 3.8.3)
- 本地 Mock 通訊庫：ws (版本 8.21.0，僅用於模擬伺服器推送 Tick 資料)

## 專案結構 (Project Structure)

專案結構基於 Next.js App Router 與扁平化的前端架構設計，具體如下：

- app/
  - globals.css：全域 CSS 檔案，載入 Tailwind CSS v4 並定義主題變數。
  - layout.tsx：全域佈局，設定字型與頁面基礎結構。
  - page.tsx：主畫面入口，載入圖表組件、控制面板與效能監控組件。
- components/
  - PerformanceMonitor.tsx：效能監控面板，使用 requestAnimationFrame 統計並即時顯示 FPS、吞吐量。
  - TradingChart.tsx：核心圖表組件，負責 Lightweight Charts 的 Canvas 初始化、節流渲染以及最新價格 DOM 的直接操作。
- constants/
  - chart.ts：集中管理系統設定參數，例如心跳時間、指數退避重連參數與環狀緩衝容量上限。
- hooks/
  - useHighFrequencyData.ts：自訂 React Hook，封裝 Web Worker 生命週期，管理頁面可見性狀態 (Page Visibility API)，並設計訂閱者模式隔離資料流。
- lib/
  - circular-buffer.ts：環狀緩衝區 (Circular Buffer) 資料結構實作，確保固定記憶體配置以消除垃圾回收卡頓。
- scripts/
  - mock-server.js：本地 Mock WebSocket 伺服器，用來模擬每 10 毫秒高頻推送隨機價格 Tick 資料。
- types/
  - chart.ts：強型別定義，包括通訊資料格式、連線狀態與 Web Worker 雙向通訊協定。
- workers/
  - data.worker.ts：Web Worker 背景腳本，於獨立執行緒處理 WebSocket 連線、封包解析、心跳檢測與資料重連機制。
- eslint.config.mjs：ESLint v10 扁平配置文件。
- .prettierrc：Prettier 排版格式化設定檔。
- tsconfig.json：TypeScript 編譯設定檔。
- package.json：專案依賴與腳本定義檔。

## 如何啟動與結束

本專案完全以 Bun 作為執行與套件管理工具。請遵循以下步驟操作。

### 啟動服務步驟

1. 初始化專案與安裝依賴：
   在專案根目錄下執行以下指令以安裝依賴項目：

   ```bash
   bun install
   ```

2. 啟動 Mock WebSocket 伺服器：
   執行以下指令啟動模擬伺服器，服務預設會監聽 `ws://localhost:8080` 並以每秒 100 次的頻率推送價格：

   ```bash
   bun run scripts/mock-server.js
   ```

3. 啟動 Next.js 開發伺服器：
   開啟另一個終端機視窗，執行以下指令以熱重載模式啟動前端：
   ```bash
   bun --hot dev
   ```
   啟動後，請以瀏覽器開啟 `http://localhost:3000` 即可檢視運作中的即時圖表。

### 結束服務步驟

1. 終止 Mock 伺服器與前端伺服器：
   分別在運行中之終端機視窗中，按下 `Ctrl + C` 鍵即可安全關閉服務。

## 特殊設定參數 (Special Configuration Parameters)

專案內的核心效能與運作常數皆集中定義於 `constants/chart.ts` 中。您可以根據硬體與實測需求修改以下參數：

- 預設 WebSocket 連線網址 (DEFAULT_WS_URL)
  - 預設值：`ws://localhost:8080`
  - 說明：指定前端 Web Worker 連線的目標 WebSocket 伺服器位址。

- 心跳發送間隔時間 (PING_INTERVAL_MS)
  - 預設值：`30000` 毫秒 (30 秒)
  - 說明：Web Worker 定期向伺服器發送 PING 訊號的間隔。

- 心跳超時判定時間 (PONG_TIMEOUT_MS)
  - 預設值：`5000` 毫秒 (5 秒)
  - 說明：發送 PING 後，若超過此時間未收到 PONG 則觸發斷線重連。

- 指數退避重連初始延遲 (INITIAL_RECONNECT_DELAY_MS)
  - 預設值：`1000` 毫秒 (1 秒)
  - 說明：當連線中斷時，首次嘗試重新連線的等待延遲。

- 指數退避重連最大延遲 (MAX_RECONNECT_DELAY_MS)
  - 預設值：`30000` 毫秒 (30 秒)
  - 說明：當連續重連失敗時，重連延遲隨次數呈指數成長，最高限制在此上限。

- 環狀緩衝區固定容量上限 (BUFFER_CAPACITY)
  - 預設值：`1000` 筆
  - 說明：背景快取高頻資料的數量上限。此值越大越消耗記憶體，但能保留更多歷史數據。

- 最新價格 DOM 更新節流時間 (TEXT_UPDATE_THROTTLE_MS)
  - 預設值：`100` 毫秒
  - 說明：限制文字價格的更新頻率。因為人眼無法看清高於 100 毫秒的文字變動，透過此節流可顯著降低主執行緒對 DOM 的頻繁操作開銷。
