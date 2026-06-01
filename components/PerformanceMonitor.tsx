'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { TickData } from '../types/chart';
import { CHART_CONSTANTS } from '../constants/chart';

interface PerformanceMonitorProps {
  subscribeTick: (cb: (tick: TickData) => void) => () => void;
  subscribeHistory: (cb: (history: TickData[]) => void) => () => void;
}

interface PerfStats {
  fps: number;
  totalTicks: number;
  throughput: number;
  historySize: number;
}

export default function PerformanceMonitor({
  subscribeTick,
  subscribeHistory,
}: PerformanceMonitorProps) {
  const [stats, setStats] = useState<PerfStats>({
    fps: 0,
    totalTicks: 0,
    throughput: 0,
    historySize: 0,
  });

  // 使用 useRef 同步保存數據，避免高頻 Tick 直接觸發 React 重繪
  const totalTicksRef = useRef<number>(0);
  const ticksThisSecondRef = useRef<number>(0);
  const historySizeRef = useRef<number>(0);

  // 1. 訂閱歷史快照以獲取目前的快取大小
  useEffect(() => {
    const unsubscribe = subscribeHistory((history) => {
      historySizeRef.current = history.length;
    });
    return unsubscribe;
  }, [subscribeHistory]);

  // 2. 訂閱 Tick，僅做加累加，維持效能
  useEffect(() => {
    const unsubscribe = subscribeTick((_tick) => {
      totalTicksRef.current++;
      ticksThisSecondRef.current++;
    });
    return unsubscribe;
  }, [subscribeTick]);

  // 3. 使用 requestAnimationFrame 精確統計 FPS (每秒更新一次 UI)
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    let animationFrameId: number;

    const calculateStats = () => {
      const now = performance.now();
      frameCount++;

      if (now - lastTime >= 1000) {
        const elapsedSeconds = (now - lastTime) / 1000;
        const currentFps = Math.round(frameCount / elapsedSeconds);
        const currentThroughput = Math.round(ticksThisSecondRef.current / elapsedSeconds);

        setStats({
          fps: currentFps,
          totalTicks: totalTicksRef.current,
          throughput: currentThroughput,
          historySize: historySizeRef.current,
        });

        frameCount = 0;
        ticksThisSecondRef.current = 0;
        lastTime = now;
      }

      animationFrameId = requestAnimationFrame(calculateStats);
    };

    animationFrameId = requestAnimationFrame(calculateStats);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // 判斷系統狀態文字與指示燈色彩
  const getSystemStatus = () => {
    if (stats.fps >= 55) {
      return { text: 'STABLE', color: 'text-[#089981] bg-[#089981]/10', dot: 'bg-[#089981]' };
    } else if (stats.fps >= 40) {
      return { text: 'WARNING', color: 'text-[#ff9800] bg-[#ff9800]/10', dot: 'bg-[#ff9800]' };
    } else {
      return { text: 'CRITICAL', color: 'text-[#f23645] bg-[#f23645]/10', dot: 'bg-[#f23645]' };
    }
  };

  const sysStatus = getSystemStatus();

  return (
    <section className="bg-[#1c2030] border border-[#2a2e39] rounded-lg p-4 flex flex-col min-h-[200px] select-none">
      {/* Telemetry 扁平化邊框標題 */}
      <h2 className="text-xs font-bold text-[#eceef2] mb-3.5 border-b border-[#2a2e39] pb-2 uppercase tracking-wider flex items-center justify-between font-mono-tv">
        <div className="flex items-center space-x-1.5">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${sysStatus.dot}`} />
          <span>核心效能與診斷 (Telemetry)</span>
        </div>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-normal ${sysStatus.color}`}
        >
          {sysStatus.text}
        </span>
      </h2>

      {/* FPS 微型進度狀態條 */}
      <div className="bg-[#131722] p-3 rounded border border-[#2a2e39]/50 mb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-[#787b86] font-bold uppercase tracking-wider">
            渲染幀率 (Frame Rate)
          </span>
          <span className="font-mono-tv text-xs font-bold text-[#eceef2]">{stats.fps} FPS</span>
        </div>
        <div className="w-full bg-[#2a2e39] h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              stats.fps >= 55 ? 'bg-[#089981]' : stats.fps >= 40 ? 'bg-[#ff9800]' : 'bg-[#f23645]'
            }`}
            style={{ width: `${Math.min((stats.fps / 60) * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* 效能指標網格面板 */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-[#131722] p-2.5 rounded border border-[#2a2e39]/50 flex flex-col">
          <span className="text-[8px] text-[#787b86] font-bold uppercase tracking-wider mb-1">
            累計撮合數
          </span>
          <span className="font-mono-tv text-sm font-bold text-[#2962ff] truncate">
            {stats.totalTicks.toLocaleString()}
          </span>
        </div>

        <div className="bg-[#131722] p-2.5 rounded border border-[#2a2e39]/50 flex flex-col">
          <span className="text-[8px] text-[#787b86] font-bold uppercase tracking-wider mb-1">
            快取緩衝池
          </span>
          <span className="font-mono-tv text-sm font-bold text-[#089981] truncate">
            {stats.historySize}
            <span className="text-[8px] text-[#787b86] font-normal ml-0.5">
              /{CHART_CONSTANTS.BUFFER_CAPACITY}
            </span>
          </span>
        </div>

        <div className="bg-[#131722] p-2.5 rounded border border-[#2a2e39]/50 flex flex-col">
          <span className="text-[8px] text-[#787b86] font-bold uppercase tracking-wider mb-1">
            數據吞吐量
          </span>
          <span className="font-mono-tv text-sm font-bold text-[#ff9800] truncate">
            {stats.throughput}
            <span className="text-[8px] text-[#787b86] font-normal ml-0.5">t/s</span>
          </span>
        </div>
      </div>
    </section>
  );
}
