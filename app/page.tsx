'use client';

import { useEffect, useState } from 'react';
import { useHighFrequencyData } from '../hooks/useHighFrequencyData';
import type { TickData } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

export default function Home() {
  const { connectionStatus, connect, disconnect, clearData, subscribeTick, subscribeHistory } =
    useHighFrequencyData({
      wsUrl: CHART_CONSTANTS.DEFAULT_WS_URL,
    });

  const [lastTick, setLastTick] = useState<TickData | null>(null);
  const [historySize, setHistorySize] = useState<number>(0);
  const [tickCount, setTickCount] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);

  // 1. 訂閱單一 Tick，並計算收到的 Tick 數量
  useEffect(() => {
    const unsubscribe = subscribeTick((tick) => {
      setLastTick(tick);
      setTickCount((prev) => prev + 1);
    });
    return unsubscribe;
  }, [subscribeTick]);

  // 2. 訂閱歷史快照，確認 GET_DATA 回傳的大小
  useEffect(() => {
    const unsubscribe = subscribeHistory((history) => {
      setHistorySize(history.length);
    });
    return unsubscribe;
  }, [subscribeHistory]);

  // 3. 計算即時 FPS 用以佐證渲染效能 (rAF)
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    let animationFrameId: number;

    const calculateFps = () => {
      const now = performance.now();
      frameCount++;

      if (now - lastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }
      animationFrameId = requestAnimationFrame(calculateFps);
    };

    animationFrameId = requestAnimationFrame(calculateFps);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // 格式化時間戳
  const formatTime = (ms: number) => {
    const date = new Date(ms);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  };

  // 連線狀態的樣式
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'CONNECTED':
        return 'bg-emerald-500 text-emerald-950 border-emerald-400';
      case 'CONNECTING':
      case 'RECONNECTING':
        return 'bg-amber-500 text-amber-950 border-amber-400 animate-pulse';
      case 'DISCONNECTED':
        return 'bg-slate-700 text-slate-100 border-slate-600';
      default:
        return 'bg-rose-500 text-rose-950 border-rose-400';
    }
  };

  return (
    <main className="min-h-screen p-6 md:p-12 flex flex-col justify-between max-w-4xl mx-auto">
      <div className="space-y-8">
        {/* 標題與簡介 */}
        <header className="border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
            高頻交易圖表 MVP - 階段三控制層驗證
          </h1>
          <p className="text-slate-400 mt-2 text-sm max-w-2xl">
            本頁面用於驗證 <code className="text-indigo-400">useHighFrequencyData</code> Hook 與背景
            Web Worker、WebSocket 的連線、重連、Page Visibility 斷線機制，以及高頻 Tick
            數據的訂閱與快取效能。
          </p>
        </header>

        {/* 控制面板與狀態 */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 左側：控制與連線狀態 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            <h2 className="text-lg font-bold text-slate-200">連線狀態控制</h2>

            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 text-xs font-semibold rounded-full border ${getStatusColor()}`}
              >
                {connectionStatus}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {CHART_CONSTANTS.DEFAULT_WS_URL}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => connect()}
                disabled={connectionStatus === 'CONNECTED' || connectionStatus === 'CONNECTING'}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg transition-colors border border-blue-500"
              >
                手動連線
              </button>
              <button
                onClick={disconnect}
                disabled={connectionStatus === 'DISCONNECTED'}
                className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-slate-800 text-slate-300 rounded-lg transition-colors border border-slate-700"
              >
                手動中斷
              </button>
              <button
                onClick={clearData}
                className="px-4 py-2 text-xs font-semibold bg-rose-950 hover:bg-rose-900 text-rose-300 rounded-lg transition-colors border border-rose-800"
              >
                清空數據
              </button>
            </div>

            <div className="text-xs text-slate-500 bg-slate-950 p-3 rounded-lg border border-slate-900 leading-relaxed">
              <span className="font-semibold text-slate-400">💡 提示</span>：切換到瀏覽器其他分頁 5
              秒鐘後切回，終端機會顯示 Mock
              連線已被自動釋放，切回後將自動重新連線並一次性拉取最新的歷史緩衝。
            </div>
          </div>

          {/* 右側：效能與緩衝區指標 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-200">效能與數據快取</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
                <div className="text-xs text-slate-500">主執行緒 FPS</div>
                <div className="text-2xl font-mono font-bold text-slate-200 mt-1">{fps}</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
                <div className="text-xs text-slate-500">累計接收 Tick</div>
                <div className="text-2xl font-mono font-bold text-indigo-400 mt-1">{tickCount}</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
                <div className="text-xs text-slate-500">緩衝快照容量</div>
                <div className="text-2xl font-mono font-bold text-emerald-400 mt-1">
                  {historySize} <span className="text-xs text-slate-600">/ 1000</span>
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-900">
                <div className="text-xs text-slate-500">當前推送頻率</div>
                <div className="text-2xl font-mono font-bold text-amber-400 mt-1">
                  ~100 <span className="text-xs text-slate-600">t/s</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 即時數據面板 */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-200">即時 Tick 數據流</h2>

          {lastTick ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-950 p-4 rounded-lg border border-slate-900">
                <div>
                  <span className="text-xs text-slate-500 block">最新 Tick 時間</span>
                  <span className="font-mono text-sm text-slate-300">
                    {formatTime(lastTick.time)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500 block">最新 Tick 價格</span>
                  <span className="font-mono text-2xl font-bold text-emerald-400">
                    ${lastTick.price.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* 簡單的歷史數據清單 */}
              <div className="space-y-2">
                <span className="text-xs text-slate-500 font-bold block">
                  近期快照快取 (最近 5 筆)：
                </span>
                <div className="bg-slate-950 rounded-lg border border-slate-900 p-3 divide-y divide-slate-900 font-mono text-xs text-slate-400">
                  {/* 動態列出最後五筆資料，為避免 React 重繪我們從 historyRef 拿 */}
                  <TickList subscribeTick={subscribeTick} />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center border border-dashed border-slate-800 rounded-lg text-slate-500 text-sm">
              等待 WebSocket 推送數據... (請確認已啟動 mock-server)
            </div>
          )}
        </section>
      </div>

      <footer className="text-center text-xs text-slate-600 mt-12 border-t border-slate-900 pt-6">
        高頻交易圖表系統 MVP &copy; 2026. All rights reserved.
      </footer>
    </main>
  );
}

// 輔助組件：獨立訂閱最新 Tick 以維護最近五筆列表，避免主 Page 頻繁重繪
function TickList({
  subscribeTick,
}: {
  subscribeTick: (cb: (tick: TickData) => void) => () => void;
}) {
  const [list, setList] = useState<TickData[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeTick((tick) => {
      setList((prev) => {
        const newList = [tick, ...prev];
        return newList.slice(0, 5);
      });
    });
    return unsubscribe;
  }, [subscribeTick]);

  if (list.length === 0) return <div className="text-slate-600 text-center py-2">無數據</div>;

  return (
    <>
      {list.map((item, idx) => (
        <div key={item.time + '-' + idx} className="flex justify-between py-2">
          <span>{new Date(item.time).toLocaleTimeString()}</span>
          <span className="text-emerald-400 font-bold">${item.price.toFixed(2)}</span>
        </div>
      ))}
    </>
  );
}
