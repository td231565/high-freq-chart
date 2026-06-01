# 高頻交易圖表 MVP 實作計畫書 (Implementation Plan)

本計畫書根據高頻圖表處理的規格書 (SPEC)，規劃出對應的技術棧、專案目錄結構、服務啟動流程、效能與功能驗證方法，以及各個開發階段的 TODO 清單。本計畫採用 **Bun** 作為套件管理工具，並鎖定 2026 年最新穩定版之 ESLint、Prettier 與 TypeScript。

---

## 1. 鎖定技術棧與版號 (Locked Tech Stack & Versions)

本 MVP 專案嚴格鎖定以下 2026 年最新穩定版號：

- **套件管理與執行環境**：`Bun: ^1.3.x` (含 `bun-types: ^1.3.14`)
  - _全面替代 npm，提供更快的依賴安裝與原生 TypeScript 執行支援。_
- **前端核心框架**：`next: ^16.2.6` (React `^19.0.0` / React DOM `^19.0.0`)
- **高頻圖表庫**：`lightweight-charts: ^5.2.0`
- **樣式配置**：`tailwindcss: ^4.3.0` (Tailwind v4 CSS-first 架構)
- **程式碼品質與格式化 (Linter & Formatter)**：
  - `typescript: ^6.0.3`
  - `eslint: ^10.4.1` (採用 ESLint v10 扁平配置 Flat Config)
  - `eslint-config-next: ^16.2.6` (Next.js 16 專用規則)
  - `prettier: ^3.8.3`
- **Mock 數據通訊**：`ws: ^8.21.0` (僅用於本地模擬伺服器)

---

## 2. 最新專案結構 (Project Structure)

配合 **ESLint v10 (Flat Config)**、**Prettier** 以及 **Tailwind CSS v4** 的新配置，專案目錄結構如下：

```text
high-frequency-chart-mvp/
├── app/
│   ├── globals.css               # 全局 CSS：載入 Tailwind v4 與配置主題變數
│   ├── layout.tsx                # 全局佈局：配置字型
│   └── page.tsx                  # 主畫面：載入圖表、效能監控與連線控制組件
├── components/
│   ├── PerformanceMonitor.tsx    # 效能監控面板：顯示即時 FPS 與數據吞吐量
│   └── TradingChart.tsx          # 圖表組件：Canvas 渲染、rAF 循環與直接修改 DOM
├── constants/
│   └── chart.ts                  # 系統配置常數：集中管理心跳、重連、快取容量等常數
├── hooks/
│   └── useHighFrequencyData.ts   # 自定義 Hook：管理 Web Worker 的生命週期與數據快照
├── lib/
│   └── circular-buffer.ts        # 環狀緩衝區：實作固定長度陣列防止 GC 卡頓
├── scripts/
│   └── mock-server.js            # 本地 Mock WebSocket 伺服器：模擬推送 Tick 資料
├── types/
│   └── chart.ts                  # 強型別定義：定義數據格式、連線狀態與 Worker 雙向通訊協定
├── workers/
│   └── data.worker.ts            # Web Worker：於獨立執行緒處理 WS 連線與數據緩衝
├── .prettierrc                   # Prettier 程式碼格式化配置檔
├── eslint.config.mjs             # ESLint v10 扁平配置文件 (Flat Config)
├── tsconfig.json                 # TypeScript v6 設定檔
└── package.json                  # Bun 專案依賴配置文件
```

---

## 3. 新增程式碼品質配置規格

### 3.1 ESLint v10 扁平配置 (`eslint.config.mjs`)

在 ESLint v10 中，全面採用扁平配置 (Flat Config)，不再使用舊版 `.eslintrc.json`。

```javascript
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  js.configs.recommended,
  ...compat.extends('next/core-web-vitals'),
  ...compat.extends('next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
];
```

### 3.2 Prettier 配置 (`.prettierrc`)

宣告統一的程式碼排版風格。

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

---

## 4. 如何啟動服務 (How to Start the Service)

本專案完全使用 **Bun** 作為執行與套件管理工具。

### 步驟一：初始化專案與安裝依賴項目

```bash
# 安裝生產環境依賴
bun add next@16.2.6 react@19.0.0 react-dom@19.0.0 lightweight-charts@5.2.0 tailwindcss@4.3.0 @tailwindcss/postcss

# 安裝開發與代碼品質規範工具 (ESLint v10, Prettier v3, TS v6)
bun add -d typescript@6.0.3 eslint@10.4.1 eslint-config-next@16.2.6 prettier@3.8.3 @types/react@19.0.0 @types/react-dom@19.0.0 ws@8.21.0 bun-types@1.3.14
```

### 步驟二：啟動 Mock WebSocket 伺服器

1. 在 `scripts/mock-server.js` 中建立一個簡單的 Node.js 服務，模擬每隔 5ms 到 10ms 推送一筆隨機波動的價格。
2. 使用 Bun 啟動 Mock 伺服器：

```bash
bun run scripts/mock-server.js
```

_預設將啟動於 `ws://localhost:8080`_

### 步驟三：啟動 Next.js 開發伺服器

```bash
bun --hot dev
```

_透過 Bun 的熱重載功能啟動開發伺服器於 `http://localhost:3000`_

---

## 5. 如何驗證與測試 (How to Verify & Test)

### 5.1 程式碼品質與排版驗證

在開發過程中，可隨時透過 Bun 執行 Linter 與 Formatter 的檢查，確保代碼完全符合資深工程師的規範：

```bash
# 執行 ESLint 語法檢查
bunx eslint .

# 執行 Prettier 代碼排版格式化
bunx prettier --write .
```

### 5.2 渲染效能與容錯驗證

1. **FPS 與 CPU 監控**：開啟 Chrome DevTools 的 **Frame Rendering Stats**，確認在每秒 100 筆以上的高頻 Tick 推送下，畫面維持在 **58 - 60 FPS**。
2. **記憶體 GC 監控**：在 DevTools Performance 面板錄製中，確認 **JS Heap** 曲線因環狀緩衝區（Circular Buffer）的記憶體重用而呈現平緩鋸齒狀，無大幅度垃圾回收或階梯式漏失。
3. **分頁生命週期測試**：切換瀏覽器分頁至背景，確認終端機的 `mock-server.js` 顯示該客戶端連線已因 `visibilityState === 'hidden'` 觸發斷開；切回原分頁後確認連線秒級自動恢復。

---

## 6. 開發階段 TODO 清單 (Development Phases)

以下為本 MVP 專案的逐步開發指南：

```markdown
- [x] 階段一：環境初始化與代碼規範配置
  - [x] 使用 Bun 初始化專案，並安裝指定版號之 Next.js v16、Lightweight Charts v5、Tailwind v4、TS v6、ESLint v10 與 Prettier v3
  - [x] 建立 `eslint.config.mjs` 設定 ESLint v10 Flat Config
  - [x] 建立 `.prettierrc` 設定代碼格式化規則
  - [x] 設定 `app/globals.css` 以 CSS-first 方式載入 Tailwind v4 與設定主題變數
  - [x] 撰寫 `scripts/mock-server.js`，使用 Bun 啟動高頻（每秒 100 次）Tick 數據推送與 PING/PONG 心跳響應 (ws@8.21.0)
- [x] 階段二：記憶體與背景數據處理層實作
  - [x] 建立 `lib/circular-buffer.ts`，實作固定長度的環狀緩衝區，確保重複利用陣列空間
  - [x] 建立 `workers/data.worker.ts`，在獨立執行緒中建立 WebSocket 連線與數據緩衝，並實作指數退避重連機制與 30 秒心跳檢測
- [ ] 階段三：React 控制層與 Hook 整合
  - [ ] 建立 `hooks/useHighFrequencyData.ts` 自定義 Hook，在 `useEffect` 中安全實例化 Web Worker，避免 SSR 階段報錯，且實作卸載清除機制以防重複連線
  - [ ] 在 Hook 中使用 `useRef` 儲存最新的 Tick 數據與歷史資料，並設計**訂閱者模式 (onTick callback)** 將高頻數據流與 React 渲染流分離，避免觸發 React 重繪
  - [ ] 整合 Page Visibility API，在頁面進入背景時通知 Worker 關閉連線，返回前景時重新連線，並在圖表上處理斷線期間的「數據空白區 (Whitespace)」
  - [ ] 限制 `GET_DATA` 指令的調用時機，僅在圖表初始化與重連成功後執行一次，禁止在高頻更新中呼叫以避免 GC 壓力
- [ ] 階段四：圖表與動態 UI 渲染實作
  - [ ] 使用 `next/dynamic` 以 `ssr: false` 模式動態載入 `TradingChart.tsx`，避免 SSR 水合錯誤，且不使用 `suppressHydrationWarning`
  - [ ] 建立 `components/TradingChart.tsx` 元件，初始化 `lightweight-charts` (v5.2.0) 的 Canvas 繪圖區，並訂閱 Hook 的數據流直接調用 `series.update()`
  - [ ] 於主執行緒中實作圖表數據更新節流（例如 30ms ~ 50ms 批次更新），降低圖表在高頻 Tick 推送下的重繪 CPU 佔用率
  - [ ] 使用 `useRef` 取得價格顯示的 HTML 元素，在主執行緒的 `requestAnimationFrame` (rAF) 循環中實作 100ms 節流，直接修改 `innerText` 進行高頻更新
- [ ] 階段五：效能監控與品質驗證
  - [ ] 建立 `components/PerformanceMonitor.tsx`，使用 rAF 統計並即時顯示 FPS，且每秒更新一次接收的 Tick 吞吐量（每秒僅重繪一次 React UI）
  - [ ] 執行 `bunx eslint .` 與 `bunx prettier --write .` 進行代碼規範驗證
  - [ ] 依據評審報告之效能基準值，使用 Chrome DevTools 進行 Heap 記憶體快照分析，確保在每秒 100 筆 Tick 下持續運行 10 分鐘無記憶體漏失，且幀率維持在 58 - 60 FPS
```
