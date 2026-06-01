'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useHighFrequencyData } from '../hooks/useHighFrequencyData';
import type { TickData } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

// 使用 next/dynamic 以 ssr: false 模式動態載入 TradingChart 元件，防止 SSR 水合錯誤，且不使用 suppressHydrationWarning
const TradingChart = dynamic(() => import('../components/TradingChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full flex items-center justify-center bg-slate-950 border border-slate-900 rounded-2xl">
      <div className="text-slate-500 text-sm flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span>圖表載入中...</span>
      </div>
    </div>
  ),
});

export default function Home() {
  const { connectionStatus, connect, disconnect, clearData, subscribeTick, subscribeHistory } =
    useHighFrequencyData({
      wsUrl: CHART_CONSTANTS.DEFAULT_WS_URL,
    });

  const [historySize, setHistorySize] = useState<number>(0);
  const [tickCount, setTickCount] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);

  // 1. 訂閱單一 Tick，並計算收到的 Tick 總數
  useEffect(() => {
    const unsubscribe = subscribeTick((_tick) => {
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

  // 連線狀態的樣式
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'CONNECTED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'CONNECTING':
      case 'RECONNECTING':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse';
      case 'DISCONNECTED':
        return 'bg-slate-800 text-slate-400 border-slate-700';
      default:
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-100 p-6 md:p-12 flex flex-col justify-between max-w-7xl mx-auto space-y-8">
      {/* 標題與簡介 */}
      <header className="border-b border-slate-900 pb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            高頻交易圖表 MVP - 實時 Canvas 渲染
          </h1>
          <p className="text-slate-400 mt-2 text-sm max-w-2xl">
            本專案實作了高效能的環狀緩衝區 (
            <code className="text-indigo-400">circular-buffer.ts</code>)、背景 Web Worker
            數據緩衝與斷線指數退避重連，並採用{' '}
            <code className="text-indigo-400">lightweight-charts</code> 進行 Canvas 直流渲染。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono">系統時鐘: </span>
          <span className="text-xs text-slate-300 font-mono bg-slate-950 px-2.5 py-1 rounded-md border border-slate-900">
            2026-06-01
          </span>
        </div>
      </header>

      {/* 主內容區：雙欄排版 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* 左側與中間：高頻交易圖表 (佔二分之一寬度以上) */}
        <div className="lg:col-span-2 h-[500px]">
          <TradingChart
            connectionStatus={connectionStatus}
            subscribeTick={subscribeTick}
            subscribeHistory={subscribeHistory}
          />
        </div>

        {/* 右側：控制面板與指標監控 */}
        <div className="space-y-6">
          {/* 連線控制 */}
          <section className="bg-slate-950 border border-slate-900 rounded-2xl p-6 space-y-6 shadow-xl">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <span className="w-1.5 h-3 bg-indigo-500 rounded-full" />
              連線狀態控制
            </h2>

            <div className="flex items-center justify-between bg-slate-900/40 p-4 rounded-xl border border-slate-900">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 text-xs font-semibold rounded-full border ${getStatusColor()}`}
                >
                  {connectionStatus}
                </span>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {CHART_CONSTANTS.DEFAULT_WS_URL.replace('ws://', '')}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => connect()}
                disabled={connectionStatus === 'CONNECTED' || connectionStatus === 'CONNECTING'}
                className="px-3 py-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white rounded-xl transition-all border border-indigo-500/30 hover:border-indigo-400 active:scale-95 duration-100"
              >
                手動連線
              </button>
              <button
                onClick={disconnect}
                disabled={connectionStatus === 'DISCONNECTED'}
                className="px-3 py-2.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-slate-900 text-slate-300 rounded-xl transition-all border border-slate-800 active:scale-95 duration-100"
              >
                手動中斷
              </button>
              <button
                onClick={clearData}
                className="px-3 py-2.5 text-xs font-semibold bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 rounded-xl transition-all border border-rose-900/30 active:scale-95 duration-100"
              >
                清空數據
              </button>
            </div>

            <div className="text-xs text-slate-500 bg-slate-900/20 p-4 rounded-xl border border-slate-900/50 leading-relaxed space-y-1">
              <p className="font-semibold text-slate-400">💡 分頁生命週期測試：</p>
              <p>
                切換到瀏覽器其他分頁數秒後切回，終端機將顯示 WebSocket 已因 Page Visibility API
                自動中斷釋放，切回前景後將秒級自動重連並重拉歷史快照，圖表上會自動留下斷線期間的
                <strong>數據空白區 (Whitespace)</strong>。
              </p>
            </div>
          </section>

          {/* 效能監控面板 */}
          <section className="bg-slate-950 border border-slate-900 rounded-2xl p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <span className="w-1.5 h-3 bg-emerald-500 rounded-full" />
              效能與數據快取
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
                <div className="text-xs text-slate-500">主執行緒 FPS</div>
                <div className="text-2xl font-mono font-extrabold text-slate-200 mt-1 flex items-baseline gap-1">
                  {fps} <span className="text-xs text-slate-600 font-normal">fps</span>
                </div>
              </div>
              <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
                <div className="text-xs text-slate-500">累計接收 Tick</div>
                <div className="text-2xl font-mono font-extrabold text-indigo-400 mt-1">
                  {tickCount}
                </div>
              </div>
              <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
                <div className="text-xs text-slate-500">環狀快取容量</div>
                <div className="text-2xl font-mono font-extrabold text-emerald-400 mt-1 flex items-baseline gap-1">
                  {historySize}{' '}
                  <span className="text-xs text-slate-600 font-normal">
                    / {CHART_CONSTANTS.BUFFER_CAPACITY}
                  </span>
                </div>
              </div>
              <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
                <div className="text-xs text-slate-500">接收推送頻率</div>
                <div className="text-2xl font-mono font-extrabold text-amber-400 mt-1 flex items-baseline gap-1">
                  ~100 <span className="text-xs text-slate-600 font-normal">t/s</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 底部數據流 */}
      <section className="bg-slate-950 border border-slate-900 rounded-2xl p-6 space-y-4 shadow-xl">
        <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
          <span className="w-1.5 h-3 bg-purple-500 rounded-full" />
          近期 Tick 數據監控 (快取最近 5 筆，React 獨立訂閱避免主頁重繪)
        </h2>
        <div className="bg-slate-900/20 rounded-xl border border-slate-900 p-4 divide-y divide-slate-900 font-mono text-xs text-slate-400">
          <TickList subscribeTick={subscribeTick} />
        </div>
      </section>

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

  if (list.length === 0) {
    return (
      <div className="h-16 flex items-center justify-center text-slate-600 text-sm">
        等待 WebSocket 推送數據... (請確認已在背景啟動 mock-server)
      </div>
    );
  }

  return (
    <>
      {list.map((item, idx) => (
        <div key={item.time + '-' + idx} className="flex justify-between py-2.5">
          <span className="text-slate-500">{new Date(item.time).toLocaleTimeString()}</span>
          <span className="text-emerald-400 font-bold font-mono">${item.price.toFixed(2)}</span>
        </div>
      ))}
    </>
  );
}
