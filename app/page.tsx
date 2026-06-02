'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useHighFrequencyData } from '../hooks/useHighFrequencyData';

import { CHART_CONSTANTS } from '../constants/chart';
import PerformanceMonitor from '../components/PerformanceMonitor';

// 使用 next/dynamic 以 ssr: false 載入 TradingChart 以避免 SSR 水合衝突
const TradingChart = dynamic(() => import('../components/TradingChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] w-full flex items-center justify-center bg-[#1c2030] border border-[#2a2e39] rounded-lg shadow-xl">
      <div className="text-[#787b86] text-xs flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#2962ff] border-t-transparent rounded-full animate-spin" />
        <span className="font-mono-tv">CONNECTING ENGINE...</span>
      </div>
    </div>
  ),
});

// 使用 next/dynamic 以 ssr: false 載入 VirtualTradesList
const VirtualTradesList = dynamic(() => import('../components/VirtualTradesList'), {
  ssr: false,
  loading: () => (
    <div className="w-full">
      <div className="grid grid-cols-4 text-[10px] text-[#787b86] font-bold uppercase tracking-wider pb-2 border-b border-[#2a2e39]/50 select-none mb-1">
        <span>時間 (Time)</span>
        <span>價格 (Price USDT)</span>
        <span className="text-right">數量 (Size BTC)</span>
        <span className="text-right">類型 (Type)</span>
      </div>
      <div 
        className="w-full flex items-center justify-center text-[#787b86] text-xs font-mono-tv select-none border-b border-[#2a2e39]/20"
        style={{ height: '240px' }}
      >
        LOADING RECYCLE ENGINE...
      </div>
    </div>
  ),
});



interface LogItem {
  id: string;
  time: string;
  msg: string;
  type: 'info' | 'success' | 'warn';
}

export default function Home() {
  const {
    connectionStatus,
    connect,
    disconnect,
    clearData,
    subscribeTick,
    subscribeHistory,
    getTradeCount,
    getTradeItem,
    setFrozen,
  } = useHighFrequencyData({
    wsUrl: CHART_CONSTANTS.DEFAULT_WS_URL,
  });

  const [logs, setLogs] = useState<LogItem[]>([]);

  // 當連線狀態改變時，更新系統通訊日誌 (Telemetry System Logs)
  useEffect(() => {
    const timeStr = new Date().toLocaleTimeString();
    let msg = '';
    let type: 'info' | 'success' | 'warn' = 'info';

    switch (connectionStatus) {
      case 'CONNECTED':
        msg = 'Connection established. Handshakes complete.';
        type = 'success';
        break;
      case 'CONNECTING':
        msg = 'Connecting to high-frequency WebSocket...';
        type = 'info';
        break;
      case 'RECONNECTING':
        msg = 'Link interrupted. Retrying exponential backoff...';
        type = 'warn';
        break;
      case 'DISCONNECTED':
        msg = 'Terminal offline. Safe release of active buffers.';
        type = 'info';
        break;
    }

    setLogs((prev) => [
      { id: Math.random().toString(), time: timeStr, msg, type },
      ...prev.slice(0, 10), // 保留最近 10 筆
    ]);
  }, [connectionStatus]);

  return (
    <main className="min-h-screen bg-[#131722] text-[#d1d4dc] p-3 md:p-6 flex flex-col justify-between max-w-[1600px] mx-auto space-y-4">
      {/* 類 TradingView 極簡頂部 Header 列 */}
      <header className="h-10 min-h-[40px] flex items-center justify-between border-b border-[#2a2e39] pb-3 select-none">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-5 bg-[#2962ff] rounded-sm" />
          <h1 className="text-sm font-bold tracking-wider text-[#eceef2] font-mono-tv">
            ANTIGRAVITY TERMINAL
          </h1>
          <span className="text-[10px] bg-[#1c2030] text-[#2962ff] border border-[#2962ff]/20 px-1.5 py-0.5 rounded font-bold">
            PRO v3.5
          </span>
        </div>
        <div className="flex items-center space-x-4 text-[11px] text-[#787b86]">
          <div className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#089981]" />
            <span>Server Time:</span>
            <span className="font-mono-tv text-[#eceef2]">2026-06-01 16:58:34</span>
          </div>
        </div>
      </header>

      {/* 交易所終端網格排版 */}
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 items-stretch flex-1">
        {/* 左側：大圖表與即時成交明細 (佔比 72%) */}
        <div className="lg:col-span-7 flex flex-col space-y-4 min-h-[780px]">
          {/* 圖表渲染區 */}
          <div className="h-[520px] flex-shrink-0">
            <TradingChart
              connectionStatus={connectionStatus}
              subscribeTick={subscribeTick}
              subscribeHistory={subscribeHistory}
              connect={connect}
              disconnect={disconnect}
              clearData={clearData}
            />
          </div>

          {/* 實時成交明細 (Public Trades Log) */}
          <div className="flex-1 bg-[#1c2030] border border-[#2a2e39] rounded-lg p-4 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-3 border-b border-[#2a2e39] pb-2 select-none">
              <h2 className="text-xs font-bold text-[#eceef2] flex items-center space-x-1.5 uppercase tracking-wider font-mono-tv">
                <span className="w-1 h-2.5 bg-[#089981] rounded-sm" />
                <span>實時成交明細 (Public Trades)</span>
              </h2>
              <span className="text-[10px] text-[#787b86] font-mono-tv bg-[#131722] px-2 py-0.5 rounded">
                Feed: 100 t/s
              </span>
            </div>

              <VirtualTradesList
                getTradeCount={getTradeCount}
                getTradeItem={getTradeItem}
                subscribeTick={subscribeTick}
                subscribeHistory={subscribeHistory}
                setFrozen={setFrozen}
              />
          </div>
        </div>

        {/* 右側：系統 Telemetry 監控與連線診斷日誌 (佔比 28%) */}
        <div className="lg:col-span-3 flex flex-col space-y-4">
          {/* 系統效能診斷 */}
          <PerformanceMonitor subscribeTick={subscribeTick} subscribeHistory={subscribeHistory} />

          {/* 連線診斷日誌 */}
          <div className="flex-1 bg-[#1c2030] border border-[#2a2e39] rounded-lg p-4 flex flex-col min-h-[300px]">
            <h2 className="text-xs font-bold text-[#eceef2] mb-3 border-b border-[#2a2e39] pb-2 uppercase tracking-wider flex items-center space-x-1.5 font-mono-tv select-none">
              <span className="w-1 h-2.5 bg-[#2962ff] rounded-sm" />
              <span>連線診斷日誌 (System Logs)</span>
            </h2>

            <div className="flex-1 overflow-y-auto font-mono-tv text-[11px] space-y-2 select-text">
              {logs.length === 0 ? (
                <div className="text-[#787b86] h-full flex items-center justify-center">
                  NO TELEMETRY LOG RECORDED
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start space-x-2 leading-relaxed">
                    <span className="text-[#787b86] flex-shrink-0">[{log.time}]</span>
                    <span
                      className={
                        log.type === 'success'
                          ? 'text-[#089981]'
                          : log.type === 'warn'
                            ? 'text-[#ff9800]'
                            : 'text-[#2962ff]'
                      }
                    >
                      {log.type === 'success' ? '✓' : log.type === 'warn' ? '⚠' : 'ℹ'}
                    </span>
                    <span className="text-[#eceef2] break-all">{log.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 靜態提示 */}
          <div className="bg-[#1c2030]/50 border border-[#2a2e39] p-4 rounded-lg select-none">
            <h3 className="text-[11px] font-bold text-[#eceef2] mb-1 font-mono-tv uppercase">
              💡 分頁管理與頻寬優化
            </h3>
            <p className="text-[10px] text-[#787b86] leading-relaxed">
              當您切換到其他瀏覽器分頁時，診斷日誌會記錄連線已自動釋放，切回前景後秒級重連。這是系統利用
              Visibility API 避免高頻背景快取積壓的優化策略。
            </p>
          </div>
        </div>
      </div>

      <footer className="text-center text-[10px] text-[#787b86] pt-3 border-t border-[#2a2e39] select-none">
        ANTIGRAVITY HIGH-FREQUENCY TERMINAL MVP &copy; 2026. All rights reserved.
      </footer>
    </main>
  );
}


