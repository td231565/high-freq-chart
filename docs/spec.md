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

### 核心技術要點：

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

## 3. 核心程式碼實作規格 (Core Code Implementation)

### 3.1 環狀緩衝區 (`lib/circular-buffer.ts`)

避免高頻 `push` 和 `shift` 導致陣列重新分配記憶體。

```typescript
export class CircularBuffer<T> {
  private buffer: Array<T | null>;
  private size: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array<T | null>(size).fill(null);
  }

  // 寫入數據
  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    } else {
      // 緩衝區滿了，覆蓋最舊的數據，head 向後移動
      this.head = (this.head + 1) % this.size;
    }
  }

  // 轉換成普通陣列（按時間順序）
  toArray(): T[] {
    const result: T[] = [];
    let current = this.head;
    for (let i = 0; i < this.count; i++) {
      if (this.buffer[current] !== null) {
        result.push(this.buffer[current] as T);
      }
      current = (current + 1) % this.size;
    }
    return result;
  }

  // 清空緩衝區
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }
}
```

### 3.2 Web Worker 數據處理 (`workers/data.worker.ts`)

在獨立執行緒進行 WebSocket 連線與高頻計算。

```typescript
import { CircularBuffer } from '../lib/circular-buffer';

let socket: WebSocket | null = null;
let reconnectTimer: any = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000; // 1秒

// 初始化緩衝區
const buffer = new CircularBuffer<{ time: number; price: number }>(1000);

// 指數退避重連機制
function connectWebSocket(url: string) {
  if (socket) {
    socket.close();
  }

  socket = new WebSocket(url);

  socket.onmessage = (event) => {
    try {
      const rawData = JSON.parse(event.data);

      // 1. 數據結構轉換與防禦性驗證
      const tick = {
        time: rawData.t, // 時間戳記
        price: parseFloat(rawData.p), // 價格
      };

      if (isNaN(tick.price)) return;

      // 2. 寫入環狀緩衝區
      buffer.push(tick);

      // 3. 批次發送數據至主執行緒 (每 16ms 送一次，或累積到一定數量再送)
      postMessage({
        type: 'TICK',
        data: tick,
        history: buffer.toArray(),
      });
    } catch (e) {
      console.error('解析 WebSocket 數據失敗:', e);
    }
  };

  socket.onclose = () => {
    postMessage({ type: 'STATUS', status: 'DISCONNECTED' });
    attemptReconnect(url);
  };

  socket.onerror = () => {
    postMessage({ type: 'STATUS', status: 'ERROR' });
  };

  socket.onopen = () => {
    reconnectAttempts = 0;
    postMessage({ type: 'STATUS', status: 'CONNECTED' });
    // 啟動心跳檢測
    startHeartbeat();
  };
}

function attemptReconnect(url: string) {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    postMessage({ type: 'STATUS', status: 'FAILED' });
    return;
  }

  const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;

  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectWebSocket(url);
  }, delay);
}

let heartbeatTimer: any = null;
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'PING' }));
    }
  }, 30000); // 30秒心跳
}

self.onmessage = (event) => {
  const { command, url } = event.data;
  if (command === 'CONNECT') {
    connectWebSocket(url);
  } else if (command === 'DISCONNECT') {
    if (socket) socket.close();
    clearTimeout(reconnectTimer);
    clearInterval(heartbeatTimer);
  }
};
```

### 3.3 核心 React Hook (`hooks/useHighFrequencyData.ts`)

橋接 Web Worker 與 `requestAnimationFrame` 繪圖循環。

```typescript
import { useEffect, useRef, useState } from 'react';

export interface TickData {
  time: number;
  price: number;
}

export function useHighFrequencyData(wsUrl: string) {
  const workerRef = useRef<Worker | null>(null);

  // 使用 useRef 儲存數據，避開 React State 重新渲染
  const latestTickRef = useRef<TickData | null>(null);
  const historyRef = useRef<TickData[]>([]);

  // 僅用 React State 儲存低頻狀態（如連線狀態）
  const [status, setStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');

  useEffect(() => {
    // 1. 初始化 Web Worker
    workerRef.current = new Worker(new URL('../workers/data.worker.ts', import.meta.url), {
      type: 'module',
    });

    workerRef.current.onmessage = (event) => {
      const { type, data, history, status: wsStatus } = event.data;

      if (type === 'TICK') {
        latestTickRef.current = data;
        historyRef.current = history;
      } else if (type === 'STATUS') {
        setStatus(wsStatus);
      }
    };

    workerRef.current.postMessage({ command: 'CONNECT', url: wsUrl });

    // 2. 監聽分頁可見性狀態 (Page Visibility API)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 進入背景：中斷連線，停止接收數據以節省效能
        workerRef.current?.postMessage({ command: 'DISCONNECT' });
      } else {
        // 返回前景：重新建立連線，同步最新數據
        workerRef.current?.postMessage({ command: 'CONNECT', url: wsUrl });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      workerRef.current?.terminate();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [wsUrl]);

  return {
    latestTickRef,
    historyRef,
    status,
  };
}
```

### 3.4 圖表與渲染組件 (`components/TradingChart.tsx`)

使用 `requestAnimationFrame` 驅動 `lightweight-charts` 進行高頻繪製。配合 **v5.2.0** API 進行繪製。

```typescript
'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, LineSeries, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useHighFrequencyData } from '../hooks/useHighFrequencyData';

interface TradingChartProps {
  wsUrl: string;
}

export default function TradingChart({ wsUrl }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // 文字顯示節流 DOM 引用
  const priceDisplayRef = useRef<HTMLSpanElement>(null);
  const lastUpdatedTimeRef = useRef<number>(0);

  const { latestTickRef, historyRef, status } = useHighFrequencyData(wsUrl);

  // 1. 初始化圖表 (只執行一次)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 建立輕量化 Canvas 圖表
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { type: 'solid', color: '#050b14' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });

    // v5 API 變更：必須傳入 LineSeries 類別並調用 addSeries
    const series = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // 處理 RWD
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.resize(chartContainerRef.current.clientWidth, 400);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // 2. 核心：rAF 渲染循環
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const currentTick = latestTickRef.current;
      const now = performance.now();

      if (currentTick && seriesRef.current) {
        // 更新圖表 Canvas (不透過 React State)
        seriesRef.current.update({
          time: currentTick.time / 1000 as any, // 轉換成秒級時間戳
          value: currentTick.price,
        });

        // 節流更新 DOM：人眼看不清每毫秒變動的文字，限制每 100ms 更新一次
        if (now - lastUpdatedTimeRef.current >= 100 && priceDisplayRef.current) {
          priceDisplayRef.current.innerText = `$${currentTick.price.toFixed(2)}`;
          lastUpdatedTimeRef.current = now;
        }
      }

      // 繼續下一次幀渲染
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    // 啟動渲染循環
    animationFrameId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [latestTickRef]);

  return (
    <div className="flex flex-col p-6 bg-brand-card rounded-2xl shadow-xl border border-slate-800">
      {/* 標頭資訊 */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">BTC/USDT 即時價格</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2.5 h-2.5 rounded-full ${
              status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-rose-500'
            }`} />
            <span className="text-sm text-slate-400">
              連線狀態: {status}
            </span>
          </div>
        </div>

        {/* 最新價格顯示 (高頻直更 DOM 節點) */}
        <div className="text-right">
          <span
            ref={priceDisplayRef}
            className="text-3xl font-mono font-bold text-emerald-400 transition-colors duration-100"
          >
            $0.00
          </span>
        </div>
      </div>

      {/* 圖表容器 */}
      <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden bg-brand-chart-bg" />
    </div>
  );
}
```

---

## 4. 效能評估指標 (Performance Evaluation Metrics)

為了驗證本 MVP 架構是否有效降低渲染負荷，前端應整合檢測機制以監控下列指標：

| 指標               | 預期表現 (資深標準)          | 說明                                                                                               |
| :----------------- | :--------------------------- | :------------------------------------------------------------------------------------------------- |
| **幀率 (FPS)**     | 58 - 60 FPS                  | UI 渲染幀率必須穩定維持在 60 幀左右，不得出現任何卡頓。                                            |
| **JS Heap 記憶體** | 呈鋸齒狀低斜率，無階梯式攀升 | 使用環狀緩衝區應能使記憶體維持在穩定區間，避免頻繁的垃圾回收 (GC) 造成微卡頓。                     |
| **CPU 使用率**     | < 10% (主執行緒)             | 核心計算已移至 Web Worker，主執行緒只做 Canvas 重繪，CPU 佔用率應保持極低。                        |
| **記憶體漏失防禦** | 0 殘留                       | 在元件解除安裝 (Unmount) 或分頁切換時，必須完全清除 `requestAnimationFrame` 循環與 `Worker` 實例。 |
