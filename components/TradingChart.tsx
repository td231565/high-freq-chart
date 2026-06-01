'use client';

import React, { useEffect, useRef } from 'react';
import { createChart, LineSeries, ColorType, ISeriesApi, Time } from 'lightweight-charts';
import type { ConnectionStatus, TickData } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

interface TradingChartProps {
  connectionStatus: ConnectionStatus;
  subscribeTick: (cb: (tick: TickData) => void) => () => void;
  subscribeHistory: (cb: (history: TickData[]) => void) => () => void;
}

export default function TradingChart({
  connectionStatus,
  subscribeTick,
  subscribeHistory,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // 用於直接修改 DOM 價格顯示的 Refs (避免 React 重繪)
  const priceDisplayRef = useRef<HTMLSpanElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const statusDisplayRef = useRef<HTMLSpanElement>(null);

  // 保存最新價格與時間，供 rAF 迴圈讀取
  const lastPriceRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // 用於 Tick 節流佇列
  const pendingTicksRef = useRef<TickData[]>([]);

  // 1. 初始化 lightweight-charts 圖表
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 建立圖表實例
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090d16' }, // 深邃極暗藍背景
        textColor: '#94a3b8', // slate-400
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e293b' }, // slate-800
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        autoScale: true,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: {
        vertLine: {
          color: '#6366f1', // indigo-500
          labelBackgroundColor: '#312e81',
        },
        horzLine: {
          color: '#6366f1',
          labelBackgroundColor: '#312e81',
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

    // v5 中使用 LineSeries
    const series = chart.addSeries(LineSeries, {
      color: '#6366f1', // 靛藍色主折線
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // 響應式圖表大小調整
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.resize(chartContainerRef.current.clientWidth, chartContainerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

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
        return;
      }

      // 處理斷線空白區 (Whitespace) 的核心演算法：
      // 遍歷歷史數據，若相鄰兩點的時間戳相差大於 3 秒，說明中間有斷線，
      // 我們在中間插入一筆只含有時間戳的 Whitespace 數據點，使圖表折線斷開。
      const chartData: ({ time: Time; value: number } | { time: Time })[] = [];
      for (let i = 0; i < history.length; i++) {
        const currentTick = history[i];
        const currentSec = Math.floor(currentTick.time / 1000);

        if (i > 0) {
          const prevTick = history[i - 1];
          const prevSec = Math.floor(prevTick.time / 1000);

          // 若時間間隔大於 3 秒，插入一筆 Whitespace 點
          if (currentSec - prevSec > 3) {
            const whitespaceSec = Math.floor((currentSec + prevSec) / 2);
            // 輕量級圖表規定：Whitespace 點僅傳入 time 屬性，不傳 value
            chartData.push({ time: whitespaceSec as Time });
          }
        }

        chartData.push({
          time: currentSec as Time,
          value: currentTick.price,
        });
      }

      // 為了避免重複的 time 導致 lightweight-charts 報錯，進行去重
      // 因為同一秒內可能有多個 ticks，在 setData 時必須確保 time 唯一，否則會丟錯。
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

      // 圖表自動滾動至最右端
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    });

    return unsubscribe;
  }, [subscribeHistory]);

  // 3. 處理即時 Tick 數據流 (實作 30ms ~ 50ms 批次更新節流)
  useEffect(() => {
    const unsubscribe = subscribeTick((tick) => {
      // 快取至 pending 佇列中
      pendingTicksRef.current.push(tick);

      // 同步更新給 rAF 迴圈使用的最新價格與時間
      lastPriceRef.current = tick.price;
      lastTimeRef.current = tick.time;
    });

    const timer = setInterval(() => {
      const series = seriesRef.current;
      if (!series || pendingTicksRef.current.length === 0) return;

      const ticksToProcess = [...pendingTicksRef.current];
      pendingTicksRef.current = [];

      // 為了防止同一個節流時間內，有重複的秒數導致輕量級圖表報錯，
      // 我們把同一秒的 ticks 做整理，在該批次中僅對 lightweight-charts 呼叫最後一個 update 即可，
      // 或者依序 update。因為 lightweight-charts 的 update 支援更新最後一個點，
      // 如果 time 相同會直接更新價格；若 time 不同會新增點。
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

  // 4. 價格與時間的直接 DOM 更新 (100ms 節流，requestAnimationFrame 實作)
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

            // 根據價格漲跌做簡單的色彩微動畫
            if (lastRenderedPrice !== null) {
              if (price > lastRenderedPrice) {
                priceDisplayRef.current.className =
                  'font-mono text-3xl font-bold text-emerald-400 transition-colors duration-100';
              } else if (price < lastRenderedPrice) {
                priceDisplayRef.current.className =
                  'font-mono text-3xl font-bold text-rose-400 transition-colors duration-100';
              }
            }
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
      // 記錄斷線的這一秒
      const disconnectSec = Math.floor(Date.now() / 1000) as Time;
      seriesRef.current.update({
        time: disconnectSec,
      }); // 傳送一個只有 time 的 whitespace 數據點
    }
  }, [connectionStatus]);

  return (
    <div className="bg-slate-950 border border-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-full">
      {/* 頂部即時面板 */}
      <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-slate-900/60 border-b border-slate-900/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-slate-500 font-medium">即時高頻價格</div>
            <span ref={priceDisplayRef} className="font-mono text-3xl font-bold text-emerald-400">
              $0.00
            </span>
          </div>
          <div className="h-8 w-px bg-slate-800 mx-2 hidden sm:block" />
          <div className="hidden sm:block">
            <div className="text-xs text-slate-500 font-medium">最新數據時間</div>
            <span ref={timeDisplayRef} className="font-mono text-sm text-slate-400">
              --:--:--.--
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <span className="text-xs text-slate-500 font-medium">連線狀態:</span>
          <span
            ref={statusDisplayRef}
            className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${
              connectionStatus === 'CONNECTED'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : connectionStatus === 'CONNECTING' || connectionStatus === 'RECONNECTING'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {connectionStatus}
          </span>
        </div>
      </div>

      {/* 圖表渲染 Canvas 容器 */}
      <div className="flex-1 min-h-[350px] relative w-full h-full p-4">
        <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />
      </div>
    </div>
  );
}
