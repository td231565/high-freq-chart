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

  // 使用 useRef 同步保存數據，避免在每次收到 Tick 時都觸發 React 重繪 (每秒 100 次)
  const totalTicksRef = useRef<number>(0);
  const ticksThisSecondRef = useRef<number>(0);
  const historySizeRef = useRef<number>(0);

  // 1. 訂閱歷史快照以獲取目前的環狀快取容量
  useEffect(() => {
    const unsubscribe = subscribeHistory((history) => {
      historySizeRef.current = history.length;
    });
    return unsubscribe;
  }, [subscribeHistory]);

  // 2. 訂閱單一 Tick，僅累加計數器而不更新 State
  useEffect(() => {
    const unsubscribe = subscribeTick((_tick) => {
      totalTicksRef.current++;
      ticksThisSecondRef.current++;
    });
    return unsubscribe;
  }, [subscribeTick]);

  // 3. 使用 requestAnimationFrame 精確統計 FPS，且限制每秒僅更新一次 React UI (1Hz)
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    let animationFrameId: number;

    const calculateStats = () => {
      const now = performance.now();
      frameCount++;

      // 當時間過去一秒 (1000ms 以上)，計算效能指標並更新一次 React 狀態
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

        // 重置當秒的計數器與時間錨點
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

  return (
    <section className="bg-slate-950 border border-slate-900 rounded-2xl p-6 space-y-4 shadow-xl">
      <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
        <span className="w-1.5 h-3 bg-emerald-500 rounded-full" />
        效能與數據快取 (每秒僅重繪一次)
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
          <div className="text-xs text-slate-500">主執行緒 FPS</div>
          <div className="text-2xl font-mono font-extrabold text-slate-200 mt-1 flex items-baseline gap-1">
            {stats.fps} <span className="text-xs text-slate-600 font-normal">fps</span>
          </div>
        </div>
        <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
          <div className="text-xs text-slate-500">累計接收 Tick</div>
          <div className="text-2xl font-mono font-extrabold text-indigo-400 mt-1">
            {stats.totalTicks}
          </div>
        </div>
        <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
          <div className="text-xs text-slate-500">環狀快取容量</div>
          <div className="text-2xl font-mono font-extrabold text-emerald-400 mt-1 flex items-baseline gap-1">
            {stats.historySize}{' '}
            <span className="text-xs text-slate-600 font-normal">
              / {CHART_CONSTANTS.BUFFER_CAPACITY}
            </span>
          </div>
        </div>
        <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-900">
          <div className="text-xs text-slate-500">即時吞吐量</div>
          <div className="text-2xl font-mono font-extrabold text-amber-400 mt-1 flex items-baseline gap-1">
            {stats.throughput} <span className="text-xs text-slate-600 font-normal">t/s</span>
          </div>
        </div>
      </div>
    </section>
  );
}
