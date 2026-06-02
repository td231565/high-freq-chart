'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ConnectionStatus, TickData, WorkerMessage, WorkerCommand } from '../types/chart';
import { CHART_CONSTANTS, VIRTUAL_LIST_CONSTANTS } from '../constants/chart';
import { CircularBuffer } from '../lib/circular-buffer';

export interface UseHighFrequencyDataOptions {
  wsUrl?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export function useHighFrequencyData(options: UseHighFrequencyDataOptions = {}) {
  const { wsUrl = CHART_CONSTANTS.DEFAULT_WS_URL, onStatusChange } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('DISCONNECTED');

  // 使用 useRef 保存 Worker 實例，避免多餘的重繪與重複建立
  const workerRef = useRef<Worker | null>(null);

  // 於主執行緒同步緩衝數據，使用與 Worker 端規格一致的 CircularBuffer 快取 (上限 1000 筆)
  const historyRef = useRef<CircularBuffer<TickData>>(
    new CircularBuffer<TickData>(VIRTUAL_LIST_CONSTANTS.TRADES_BUFFER_CAPACITY),
  );
  const lastTickRef = useRef<TickData | null>(null);

  // 實時更新之凍結狀態標記與暫存佇列
  const isFrozenRef = useRef<boolean>(false);
  const pendingTicksQueueRef = useRef<TickData[]>([]);

  // 使用 Set 管理訂閱者，提升查找與刪除效能
  const tickSubscribersRef = useRef<Set<(tick: TickData) => void>>(new Set());
  const historySubscribersRef = useRef<Set<(history: TickData[]) => void>>(new Set());

  // 暴露給外部的最新數據讀取方法 (使用 useCallback 保持參照穩定)
  const getHistory = useCallback(() => historyRef.current.toArray(), []);
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
    if (!historyRef.current.isEmpty()) {
      callback(historyRef.current.toArray());
    }
    return () => {
      historySubscribersRef.current.delete(callback);
    };
  }, []);

  // 控制是否凍結實時更新，並在解凍時批次寫入暫存資料
  const setFrozen = useCallback((frozen: boolean) => {
    isFrozenRef.current = frozen;
    if (!frozen && pendingTicksQueueRef.current.length > 0) {
      pendingTicksQueueRef.current.forEach((tick) => {
        historyRef.current.push(tick);
      });
      pendingTicksQueueRef.current = [];
      // 批次寫入後，通知歷史訂閱者
      const currentHistory = historyRef.current.toArray();
      historySubscribersRef.current.forEach((cb) => cb(currentHistory));
    }
  }, []);

  // 暴露高效的原生局部讀取 API，防止虛擬列表在大陣列下頻繁 array copy
  const getTradeCount = useCallback(() => historyRef.current.size(), []);
  const getTradeItem = useCallback((index: number) => historyRef.current.get(index), []);

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
    historyRef.current.clear();
    pendingTicksQueueRef.current = [];
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

          if (isFrozenRef.current) {
            // 凍結狀態：新收到的 Tick 暫存於佇列，不寫入主快取
            pendingTicksQueueRef.current.push(tick);
          } else {
            // 未凍結狀態：推入 CircularBuffer
            historyRef.current.push(tick);
          }

          // 無論是否凍結，皆廣播給全域 Tick 訂閱者 (例如圖表與效能監控)
          tickSubscribersRef.current.forEach((cb) => cb(tick));
          break;
        }

        case 'HISTORY': {
          const historyData = msg.data;
          historyRef.current.clear();
          historyData.forEach((tick) => historyRef.current.push(tick));

          if (historyData.length > 0) {
            lastTickRef.current = historyData[historyData.length - 1];
          }

          // 廣播給所有歷史快照訂閱者 (例如圖表進行一次性 setData)
          historySubscribersRef.current.forEach((cb) => cb(historyData));
          break;
        }

        case 'CLEARED': {
          historyRef.current.clear();
          pendingTicksQueueRef.current = [];
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
    setFrozen,
    getTradeCount,
    getTradeItem,
  };
}
