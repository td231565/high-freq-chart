'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, AreaSeries, ColorType, ISeriesApi, Time } from 'lightweight-charts';
import type { ConnectionStatus, TickData } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

interface TradingChartProps {
  connectionStatus: ConnectionStatus;
  subscribeTick: (cb: (tick: TickData) => void) => () => void;
  subscribeHistory: (cb: (history: TickData[]) => void) => () => void;
  connect: () => void;
  disconnect: () => void;
  clearData: () => void;
}

export default function TradingChart({
  connectionStatus,
  subscribeTick,
  subscribeHistory,
  connect,
  disconnect,
  clearData,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  // 用於直接修改 DOM 價格顯示的 Refs (避免 React 重繪)
  const priceDisplayRef = useRef<HTMLSpanElement>(null);
  const changeDisplayRef = useRef<HTMLSpanElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  // TradingView 資訊列 Refs
  const dayHighRef = useRef<HTMLSpanElement>(null);
  const dayLowRef = useRef<HTMLSpanElement>(null);
  const dayVolumeRef = useRef<HTMLSpanElement>(null);

  // 保存最新價格、時間與首筆歷史資料價格，供 rAF 迴圈讀取與計算
  const lastPriceRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const firstPriceRef = useRef<number | null>(null);

  // 用於 Tick 節流佇列
  const pendingTicksRef = useRef<TickData[]>([]);

  // 1. 初始化 TradingView 風格的 lightweight-charts 圖表
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 建立圖表實例，全面採用 TradingView 暗色主題配色
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' }, // TradingView 經典背景
        textColor: '#d1d4dc', // 經典灰字體色
        fontSize: 10,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif",
      },
      grid: {
        vertLines: { color: '#2a2e39' }, // 網格垂直線
        horzLines: { color: '#2a2e39' }, // 網格水平線
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        autoScale: true,
        alignLabels: true,
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: {
        vertLine: {
          color: '#787b86',
          labelBackgroundColor: '#2a2e39',
          style: 1, // 虛線
        },
        horzLine: {
          color: '#787b86',
          labelBackgroundColor: '#2a2e39',
          style: 1, // 虛線
        },
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    // 採用 AreaSeries 以實作漸層金融質感
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#2962ff', // TradingView 經典藍
      topColor: 'rgba(41, 98, 255, 0.28)', // 漸層頂端色
      bottomColor: 'rgba(41, 98, 255, 0.0)', // 漸層底端色
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.resize(chartContainerRef.current.clientWidth, chartContainerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    // 延遲一下觸發 resize 以確保容器寬度已計算完成
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // 2. 處理歷史快照訂閱 (重連或首次載入)
  useEffect(() => {
    const unsubscribe = subscribeHistory((history) => {
      if (!seriesRef.current) return;

      if (history.length === 0) {
        seriesRef.current.setData([]);
        firstPriceRef.current = null;
        return;
      }

      // 保存第一筆歷史價格用以計算當日累計漲跌幅
      firstPriceRef.current = history[0].price;

      const chartData: ({ time: Time; value: number } | { time: Time })[] = [];
      for (let i = 0; i < history.length; i++) {
        const currentTick = history[i];
        const currentSec = Math.floor(currentTick.time / 1000);

        if (i > 0) {
          const prevTick = history[i - 1];
          const prevSec = Math.floor(prevTick.time / 1000);

          // 若時間間隔大於 3 秒，插入一筆 Whitespace 點以呈現斷線空白
          if (currentSec - prevSec > 3) {
            const whitespaceSec = Math.floor((currentSec + prevSec) / 2);
            chartData.push({ time: whitespaceSec as Time });
          }
        }

        chartData.push({
          time: currentSec as Time,
          value: currentTick.price,
        });
      }

      // 確保 time 唯一去重
      const uniqueChartData: ({ time: Time; value: number } | { time: Time })[] = [];
      const seenTimes = new Set<Time>();
      for (let i = chartData.length - 1; i >= 0; i--) {
        const item = chartData[i];
        if (!seenTimes.has(item.time)) {
          seenTimes.add(item.time);
          uniqueChartData.unshift(item);
        }
      }

      seriesRef.current.setData(uniqueChartData);

      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    });

    return unsubscribe;
  }, [subscribeHistory]);

  // 3. 處理即時 Tick 數據流 (40ms 節流更新)
  useEffect(() => {
    const unsubscribe = subscribeTick((tick) => {
      pendingTicksRef.current.push(tick);
      lastPriceRef.current = tick.price;
      lastTimeRef.current = tick.time;
    });

    const timer = setInterval(() => {
      const series = seriesRef.current;
      if (!series || pendingTicksRef.current.length === 0) return;

      const ticksToProcess = [...pendingTicksRef.current];
      pendingTicksRef.current = [];

      ticksToProcess.forEach((t) => {
        const sec = Math.floor(t.time / 1000) as Time;
        series.update({
          time: sec,
          value: t.price,
        });
      });
    }, 40);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [subscribeTick]);

  // 4. 價格、時間與 TradingView 行情的直接 DOM 更新 (rAF 搭配 100ms 節流)
  useEffect(() => {
    let lastTime = 0;
    let lastRenderedPrice: number | null = null;
    let animationFrameId: number;

    const formatTime = (ms: number) => {
      const date = new Date(ms);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    };

    const updatePriceDom = (timestamp: number) => {
      if (timestamp - lastTime >= CHART_CONSTANTS.TEXT_UPDATE_THROTTLE_MS) {
        const price = lastPriceRef.current;
        const time = lastTimeRef.current;

        if (price !== null && price !== lastRenderedPrice) {
          // 直接操作 DOM 元素，完全繞過 React 渲染系統
          if (priceDisplayRef.current) {
            priceDisplayRef.current.innerText = `$${price.toFixed(2)}`;

            // 閃爍效果：跳動時短暫高亮背景，接著套用 transitions 平滑褪色
            if (lastRenderedPrice !== null) {
              const el = priceDisplayRef.current;
              el.style.transition = 'none';
              if (price > lastRenderedPrice) {
                el.style.color = '#089981';
                el.style.backgroundColor = 'rgba(8, 153, 129, 0.18)';
              } else if (price < lastRenderedPrice) {
                el.style.color = '#f23645';
                el.style.backgroundColor = 'rgba(242, 54, 69, 0.18)';
              }
              // 強制 reflow
              void el.offsetHeight;
              el.style.transition = 'all 450ms cubic-bezier(0.25, 1, 0.5, 1)';
              el.style.backgroundColor = 'transparent';
              el.style.color = price > lastRenderedPrice ? '#089981' : '#f23645';
            } else {
              priceDisplayRef.current.style.color = '#eceef2';
            }
          }

          // 漲跌幅百分比計算與更新 (相較於本批歷史第一筆價格)
          if (changeDisplayRef.current && firstPriceRef.current !== null) {
            const diff = price - firstPriceRef.current;
            const percent = (diff / firstPriceRef.current) * 100;
            const sign = diff >= 0 ? '+' : '';
            changeDisplayRef.current.innerText = `${sign}${diff.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
            if (diff >= 0) {
              changeDisplayRef.current.className =
                'font-mono-tv text-[11px] font-semibold text-[#089981] ml-2';
            } else {
              changeDisplayRef.current.className =
                'font-mono-tv text-[11px] font-semibold text-[#f23645] ml-2';
            }
          }

          // 模擬與當前價格連動的 24H 最值與成交量
          if (dayHighRef.current) {
            const high = firstPriceRef.current ? firstPriceRef.current * 1.012 : price * 1.008;
            dayHighRef.current.innerText = `$${Math.max(high, price).toFixed(2)}`;
          }
          if (dayLowRef.current) {
            const low = firstPriceRef.current ? firstPriceRef.current * 0.988 : price * 0.992;
            dayLowRef.current.innerText = `$${Math.min(low, price).toFixed(2)}`;
          }
          if (dayVolumeRef.current && time !== null) {
            const baseVol = 8452.12;
            const dynamicVol = baseVol + (time % 800000) / 100;
            dayVolumeRef.current.innerText = `${dynamicVol.toFixed(2)} BTC`;
          }

          if (timeDisplayRef.current && time !== null) {
            timeDisplayRef.current.innerText = formatTime(time);
          }

          lastRenderedPrice = price;
        }

        lastTime = timestamp;
      }
      animationFrameId = requestAnimationFrame(updatePriceDom);
    };

    animationFrameId = requestAnimationFrame(updatePriceDom);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // 5. 處理斷線狀態下，主動在圖表上劃下 Whitespace 點
  useEffect(() => {
    if (connectionStatus === 'DISCONNECTED' && seriesRef.current) {
      const disconnectSec = Math.floor(Date.now() / 1000) as Time;
      seriesRef.current.update({
        time: disconnectSec,
      });
    }
  }, [connectionStatus]);

  return (
    <div className="bg-[#1c2030] border border-[#2a2e39] rounded-lg overflow-hidden shadow-2xl flex flex-col h-full select-none">
      {/* 類 TradingView 頂部實體工具列 (Top Toolbar) */}
      <div className="h-12 min-h-[48px] flex items-center justify-between px-4 bg-[#1c2030] border-b border-[#2a2e39]">
        {/* 左側：商品、週期、價格資訊 */}
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="flex items-baseline space-x-1">
            <span className="font-bold text-sm text-[#eceef2] hover:text-[#2962ff] transition-colors cursor-pointer">
              BTCUSDT
            </span>
            <span className="text-[9px] text-[#787b86] font-semibold bg-[#2a2e39] px-1 py-0.2 rounded scale-90 origin-bottom-left">
              1S
            </span>
          </div>

          <div className="hidden sm:flex items-center space-x-1.5 text-[10px] text-[#787b86] font-mono-tv">
            <span>BINANCE</span>
            <span>•</span>
            <span className="text-[#2962ff] font-bold">⚡ HIGH-FREQ</span>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2e39] hidden sm:block" />

          {/* 即時跳動價格區 */}
          <div className="flex items-center bg-[#131722]/50 px-2 py-1 rounded border border-[#2a2e39]/30">
            <span
              ref={priceDisplayRef}
              className="font-mono-tv text-xs font-bold px-1 py-0.5 rounded transition-all text-[#eceef2]"
            >
              $0.00
            </span>
            <span
              ref={changeDisplayRef}
              className="text-[11px] font-semibold text-[#089981] ml-1.5"
            >
              +0.00 (+0.00%)
            </span>
          </div>
        </div>

        {/* 右側：24H 行情看板與具有清楚文字標籤的控制按鈕 */}
        <div className="flex items-center space-x-4">
          {/* 24H 行情資訊 (僅在較大螢幕時顯示) */}
          <div className="hidden lg:flex items-center space-x-4 border-r border-[#2a2e39] pr-4">
            <div>
              <span className="text-[#787b86] text-[9px] font-bold block leading-none">
                24H HIGH
              </span>
              <span
                ref={dayHighRef}
                className="font-mono-tv text-[11px] font-semibold text-[#eceef2]"
              >
                $0.00
              </span>
            </div>
            <div>
              <span className="text-[#787b86] text-[9px] font-bold block leading-none">
                24H LOW
              </span>
              <span
                ref={dayLowRef}
                className="font-mono-tv text-[11px] font-semibold text-[#eceef2]"
              >
                $0.00
              </span>
            </div>
            <div>
              <span className="text-[#787b86] text-[9px] font-bold block leading-none">
                24H VOLUME
              </span>
              <span
                ref={dayVolumeRef}
                className="font-mono-tv text-[11px] font-semibold text-[#eceef2]"
              >
                0.00 BTC
              </span>
            </div>
            <div className="hidden xl:block">
              <span className="text-[#787b86] text-[9px] font-bold block leading-none">
                TERMINAL TIME
              </span>
              <span ref={timeDisplayRef} className="font-mono-tv text-[11px] text-[#787b86]">
                --:--:--.--
              </span>
            </div>
          </div>

          {/* 連線狀態與控制按鈕 (加入清晰的文字標籤) */}
          <div className="flex items-center space-x-3">
            {/* 呼吸燈點 */}
            <div className="flex items-center space-x-2 bg-[#131722]/60 px-2.5 py-1 rounded border border-[#2a2e39]/50">
              <span
                className={`w-1.5 h-1.5 rounded-full relative ${
                  connectionStatus === 'CONNECTED'
                    ? 'bg-[#089981]'
                    : connectionStatus === 'CONNECTING' || connectionStatus === 'RECONNECTING'
                      ? 'bg-[#ff9800]'
                      : 'bg-[#787b86]'
                }`}
              >
                {(connectionStatus === 'CONNECTING' || connectionStatus === 'RECONNECTING') && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff9800] opacity-75" />
                )}
              </span>
              <span className="text-[9px] text-[#787b86] uppercase font-bold tracking-wider">
                {connectionStatus === 'CONNECTED'
                  ? '連線中'
                  : connectionStatus === 'DISCONNECTED'
                    ? '已中斷'
                    : '連線中'}
              </span>
            </div>

            <div className="h-5 w-[1px] bg-[#2a2e39]" />

            {/* 控制按鈕組：包含清楚中文文字與精緻圖案 */}
            <div className="flex items-center space-x-2">
              <button
                onClick={connect}
                disabled={connectionStatus === 'CONNECTED' || connectionStatus === 'CONNECTING'}
                title="手動建立 WebSocket 連線"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold bg-[#089981]/10 text-[#089981] hover:bg-[#089981]/20 disabled:opacity-20 disabled:hover:bg-[#089981]/10 rounded border border-[#089981]/30 cursor-pointer transition-all active:scale-95 duration-100"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>連線</span>
              </button>
              <button
                onClick={disconnect}
                disabled={connectionStatus === 'DISCONNECTED'}
                title="手動中斷 WebSocket 連線"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold bg-[#2a2e39] text-[#eceef2] hover:bg-[#363a45] disabled:opacity-20 disabled:hover:bg-[#2a2e39] rounded border border-[#2a2e39] cursor-pointer transition-all active:scale-95 duration-100"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <span>中斷</span>
              </button>
              <button
                onClick={clearData}
                title="清空圖表與快取數據"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold bg-[#f23645]/10 text-[#f23645] hover:bg-[#f23645]/20 rounded border border-[#f23645]/30 cursor-pointer transition-all active:scale-95 duration-100"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span>清除</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 圖表渲染 Canvas 容器 */}
      <div className="flex-1 min-h-[350px] relative w-full h-full p-2 bg-[#131722]">
        <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />
      </div>
    </div>
  );
}
