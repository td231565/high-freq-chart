'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ConnectionStatus, TickData, WorkerMessage, WorkerCommand } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

export interface UseHighFrequencyDataOptions {
  wsUrl?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export function useHighFrequencyData(options: UseHighFrequencyDataOptions = {}) {
  const { wsUrl = CHART_CONSTANTS.DEFAULT_WS_URL, onStatusChange } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('DISCONNECTED');

  // 使用 useRef 保存 Worker 實例，避免多餘的重繪與重複建立
  const workerRef = useRef<Worker | null>(null);

  // 於主執行緒同步緩衝數據，避免因寫入 React State 造成頻繁重繪 (每秒 100 次的效能瓶頸)
  const historyRef = useRef<TickData[]>([]);
  const lastTickRef = useRef<TickData | null>(null);

  // 使用 Set 管理訂閱者，提升查找與刪除效能
  const tickSubscribersRef = useRef<Set<(tick: TickData) => void>>(new Set());
  const historySubscribersRef = useRef<Set<(history: TickData[]) => void>>(new Set());

  // 暴露給外部的最新數據讀取方法 (使用 useCallback 保持參照穩定)
  const getHistory = useCallback(() => historyRef.current, []);
  const getLastTick = useCallback(() => lastTickRef.current, []);

  // 訂閱單一高頻 Tick 的方法
  const subscribeTick = useCallback((callback: (tick: TickData) => void) => {
    tickSubscribersRef.current.add(callback);
    // 若已有最新 Tick，可立即觸發一次回呼以初始化狀態
    if (lastTickRef.current) {
      callback(lastTickRef.current);
    }
    return () => {
      tickSubscribersRef.current.delete(callback);
    };
  }, []);

  // 訂閱全量歷史快照的方法 (用於重連或首頁載入)
  const subscribeHistory = useCallback((callback: (history: TickData[]) => void) => {
    historySubscribersRef.current.add(callback);
    // 若已有歷史數據，可立即觸發一次回呼以繪製初始圖表
    if (historyRef.current.length > 0) {
      callback(historyRef.current);
    }
    return () => {
      historySubscribersRef.current.delete(callback);
    };
  }, []);

  // 手動控制連線：CONNECT
  const connect = useCallback(
    (url?: unknown) => {
      if (workerRef.current) {
        const targetUrl = typeof url === 'string' ? url : wsUrl;
        const cmd: WorkerCommand = { type: 'CONNECT', url: targetUrl };
        workerRef.current.postMessage(cmd);
      }
    },
    [wsUrl],
  );

  // 手動控制連線：DISCONNECT
  const disconnect = useCallback(() => {
    if (workerRef.current) {
      const cmd: WorkerCommand = { type: 'DISCONNECT' };
      workerRef.current.postMessage(cmd);
    }
  }, []);

  // 手動清空緩衝區
  const clearData = useCallback(() => {
    if (workerRef.current) {
      const cmd: WorkerCommand = { type: 'CLEAR' };
      workerRef.current.postMessage(cmd);
    }
    historyRef.current = [];
    lastTickRef.current = null;
    // 同步通知訂閱者資料已清空
    historySubscribersRef.current.forEach((cb) => cb([]));
  }, []);

  // 初始化與生命週期監聽
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. 安全加載 Web Worker (相容 Next.js 生態系統)
    const worker = new Worker(new URL('../workers/data.worker.ts', import.meta.url));
    workerRef.current = worker;

    // 2. 監聽背景執行緒傳來的訊息
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;

      switch (msg.type) {
        case 'STATUS': {
          setConnectionStatus(msg.status);
          if (onStatusChange) {
            onStatusChange(msg.status);
          }

          // 核心控制策略：僅在重新連線或首次連線成功時，拉取一次最新的背景快照
          if (msg.status === 'CONNECTED') {
            const cmd: WorkerCommand = { type: 'GET_DATA' };
            worker.postMessage(cmd);
          }
          break;
        }

        case 'TICK': {
          const tick = msg.data;
          lastTickRef.current = tick;

          // 在主執行緒同步維護一個長度限制的快取，避免無限增長佔用記憶體
          const history = historyRef.current;
          history.push(tick);
          if (history.length > CHART_CONSTANTS.BUFFER_CAPACITY) {
            history.shift();
          }

          // 廣播給所有 Tick 訂閱者 (直接修改 DOM / Canvas)
          tickSubscribersRef.current.forEach((cb) => cb(tick));
          break;
        }

        case 'HISTORY': {
          const historyData = msg.data;
          historyRef.current = historyData;
          if (historyData.length > 0) {
            lastTickRef.current = historyData[historyData.length - 1];
          }

          // 廣播給所有歷史快照訂閱者 (例如圖表進行一次性 setData)
          historySubscribersRef.current.forEach((cb) => cb(historyData));
          break;
        }

        case 'CLEARED': {
          historyRef.current = [];
          lastTickRef.current = null;
          historySubscribersRef.current.forEach((cb) => cb([]));
          break;
        }
      }
    };

    // 3. 啟動 initial 連線
    const startCmd: WorkerCommand = { type: 'CONNECT', url: wsUrl };
    worker.postMessage(startCmd);

    // 4. Page Visibility API 整合：當頁面不可見時中斷連線以防高頻緩衝積壓，可見時恢復連線
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const cmd: WorkerCommand = { type: 'DISCONNECT' };
        worker.postMessage(cmd);
      } else if (document.visibilityState === 'visible') {
        const cmd: WorkerCommand = { type: 'CONNECT', url: wsUrl };
        worker.postMessage(cmd);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 5. 卸載清除機制，避免 React 19 Strict Mode 造成的重複連線與記憶體洩漏
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const cmd: WorkerCommand = { type: 'DISCONNECT' };
      worker.postMessage(cmd);
      worker.terminate();
      workerRef.current = null;
    };
  }, [wsUrl, onStatusChange]);

  return {
    connectionStatus,
    connect,
    disconnect,
    clearData,
    subscribeTick,
    subscribeHistory,
    getHistory,
    getLastTick,
  };
}
