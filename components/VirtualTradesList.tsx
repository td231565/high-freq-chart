'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { VIRTUAL_LIST_CONSTANTS } from '../constants/chart';
import type { TickData } from '../types/chart';

interface VirtualTradesListProps {
  getTradeCount: () => number;
  getTradeItem: (index: number) => TickData | undefined;
  subscribeTick: (cb: (tick: TickData) => void) => () => void;
  subscribeHistory: (cb: (history: TickData[]) => void) => () => void;
  setFrozen: (frozen: boolean) => void;
}

interface NodeCache {
  el: HTMLDivElement;
  timeEl: HTMLSpanElement;
  priceEl: HTMLSpanElement;
  sizeEl: HTMLSpanElement;
  typeEl: HTMLSpanElement;
}

const ITEM_HEIGHT = VIRTUAL_LIST_CONSTANTS.TRADE_ITEM_HEIGHT; // 32
const VIEWPORT_HEIGHT = VIRTUAL_LIST_CONSTANTS.VIEWPORT_HEIGHT; // 240
const BUFFER_ITEMS_COUNT = VIRTUAL_LIST_CONSTANTS.BUFFER_ITEMS_COUNT; // 2
const N = 17; // 回收節點數量，足以覆蓋 VIEWPORT_HEIGHT 內所有可視與緩衝項目

/**
 * 確定性偽隨機成交細節生成器
 * 確保同一個時標與價格在反覆滾動時，其成交量與買賣方向完全一致且穩定不閃爍
 */
function getDeterministicDetails(time: number, price: number) {
  const seed = (time * 1000 + Math.floor(price * 100)) % 1000000;
  // 簡易偽隨機數
  const x = Math.sin(seed) * 10000;
  const rand = x - Math.floor(x);
  const size = rand * 0.94 + 0.008; // 0.008 - 0.948 BTC
  const side = rand > 0.49 ? 'BUY' : 'SELL';
  return { size, side };
}

export default function VirtualTradesList({
  getTradeCount,
  getTradeItem,
  subscribeTick,
  subscribeHistory,
  setFrozen,
}: VirtualTradesListProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const runwayRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nodesCacheRef = useRef<NodeCache[]>([]);

  const isRenderPendingRef = useRef(false);
  const rAFRef = useRef<number | null>(null);

  // 核心 DOM Recycle 渲染器
  const updateDOM = useCallback(() => {
    isRenderPendingRef.current = false;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scrollTop = viewport.scrollTop;
    const totalCount = getTradeCount();

    // 1. 動態同步滾動跑道（Runway）總高度
    if (runwayRef.current) {
      runwayRef.current.style.height = `${totalCount * ITEM_HEIGHT}px`;
    }

    const nodes = nodesCacheRef.current;
    if (nodes.length === 0) return;

    // 2. 計算目前滾動區域的起始邏輯索引，並加上緩衝區
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_ITEMS_COUNT);

    // 3. 原生 DOM 回收與覆寫
    for (let nodeIdx = 0; nodeIdx < N; nodeIdx++) {
      const cache = nodes[nodeIdx];

      // 計算在此 nodeIdx 下，唯一的邏輯索引 i 位於 [startIndex, startIndex + N - 1]
      const offset = (nodeIdx - (startIndex % N) + N) % N;
      const i = startIndex + offset;

      if (i < totalCount) {
        // 有效邏輯索引：對應本地 CircularBuffer，最上方(邏輯索引 0)代表最新成交(數據索引 size - 1)
        const dataIdx = totalCount - 1 - i;
        const tick = getTradeItem(dataIdx);

        if (tick) {
          cache.el.style.display = 'grid';
          cache.el.style.transform = `translateY(${i * ITEM_HEIGHT}px)`;

          const details = getDeterministicDetails(tick.time, tick.price);

          // 直接操作 textContent 與 className 更新內容，完全避免 DOM Diff 與 querySelector
          cache.timeEl.textContent = new Date(tick.time).toLocaleTimeString();
          cache.priceEl.textContent = `$${tick.price.toFixed(2)}`;

          if (details.side === 'BUY') {
            cache.priceEl.className = 'text-[#089981] font-bold';
            cache.typeEl.className = 'text-right font-bold text-[#089981] text-[10px]';
            cache.typeEl.textContent = '▲ BUY';
          } else {
            cache.priceEl.className = 'text-[#f23645] font-bold';
            cache.typeEl.className = 'text-right font-bold text-[#f23645] text-[10px]';
            cache.typeEl.textContent = '▼ SELL';
          }

          cache.sizeEl.textContent = details.size.toFixed(4);
        } else {
          cache.el.style.display = 'none';
        }
      } else {
        // 超出總資料數量的部分，直接隱藏，徹底消除殘影與重疊
        cache.el.style.display = 'none';
      }
    }
  }, [getTradeCount, getTradeItem]);

  // 排程 rAF 渲染，避免重複更新與幀數阻塞
  const scheduleRender = useCallback(() => {
    if (isRenderPendingRef.current) return;
    isRenderPendingRef.current = true;
    rAFRef.current = requestAnimationFrame(updateDOM);
  }, [updateDOM]);

  // 1. 純客戶端延遲掛載，徹底防範 Hydration Mismatch
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 2. 原生 DOM 節點初始化與主動資源回收機制
  useEffect(() => {
    if (!isMounted) return;

    const runway = runwayRef.current;
    if (!runway) return;

    const domNodes: NodeCache[] = [];

    // 動態預先配置 N 個絕對定位的原生 DOM 節點，並直接快取子元素引用
    for (let i = 0; i < N; i++) {
      const el = document.createElement('div');
      el.className = 'grid grid-cols-4 py-2 hover:bg-[#2a2e39]/20 font-mono-tv text-xs select-none';
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.right = '0';
      el.style.height = `${ITEM_HEIGHT}px`;
      el.style.willChange = 'transform';
      el.style.contain = 'layout size';
      el.style.display = 'none'; // 預設隱藏

      const timeEl = document.createElement('span');
      timeEl.className = 'text-[#787b86]';

      const priceEl = document.createElement('span');

      const sizeEl = document.createElement('span');
      sizeEl.className = 'text-right text-[#eceef2]';

      const typeEl = document.createElement('span');

      el.appendChild(timeEl);
      el.appendChild(priceEl);
      el.appendChild(sizeEl);
      el.appendChild(typeEl);

      runway.appendChild(el);

      domNodes.push({
        el,
        timeEl,
        priceEl,
        sizeEl,
        typeEl,
      });
    }

    nodesCacheRef.current = domNodes;
    scheduleRender();

    // 卸載時主動將動態節點完全銷毀移出 DOM Tree，杜絕記憶體洩漏
    return () => {
      domNodes.forEach((node) => {
        if (node.el.parentNode) {
          node.el.parentNode.removeChild(node.el);
        }
      });
      nodesCacheRef.current = [];
      if (rAFRef.current !== null) {
        cancelAnimationFrame(rAFRef.current);
      }
    };
  }, [isMounted, scheduleRender]);

  // 3. 訂閱單一 Tick 與歷史更新以驅動 rAF 渲染
  useEffect(() => {
    if (!isMounted) return;

    const unsubscribeTick = subscribeTick(() => {
      scheduleRender();
    });

    const unsubscribeHistory = subscribeHistory(() => {
      scheduleRender();
    });

    return () => {
      unsubscribeTick();
      unsubscribeHistory();
    };
  }, [isMounted, subscribeTick, subscribeHistory, scheduleRender]);

  // 4. 註冊 Viewport passive 滾動監聽
  useEffect(() => {
    if (!isMounted) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      scheduleRender();
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, [isMounted, scheduleRender]);

  // 5. 頂部哨兵相交觀測器 (Intersection Observer)
  useEffect(() => {
    if (!isMounted) return;

    const viewport = viewportRef.current;
    const sentinel = sentinelRef.current;
    if (!viewport || !sentinel) return;

    // 當哨兵與 Viewport 相交時代表置頂，此時解除凍結；反之則凍結以防滾動時資料抖動
    const observer = new IntersectionObserver(
      ([entry]) => {
        const atTop = entry.isIntersecting;
        setIsAtTop(atTop);
        setFrozen(!atTop);
      },
      {
        root: viewport,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [isMounted, setFrozen]);

  // 回到頂部並自動解凍
  const handleScrollToTop = useCallback(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  // 骨架屏預留視窗高度：在未掛載或無資料時展示
  if (!isMounted) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-4 text-[10px] text-[#787b86] font-bold uppercase tracking-wider pb-2 border-b border-[#2a2e39]/50 select-none">
          <span>時間 (Time)</span>
          <span>價格 (Price USDT)</span>
          <span className="text-right">數量 (Size BTC)</span>
          <span className="text-right">類型 (Type)</span>
        </div>
        <div
          className="w-full flex items-center justify-center text-[#787b86] text-xs font-mono-tv select-none border-b border-[#2a2e39]/20"
          style={{ height: `${VIEWPORT_HEIGHT}px` }}
        >
          INITIALIZING TELESCOPIC RECYCLE ENGINE...
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative">
      {/* 欄位表頭 */}
      <div className="grid grid-cols-4 text-[10px] text-[#787b86] font-bold uppercase tracking-wider pb-2 border-b border-[#2a2e39]/50 select-none mb-1">
        <span>時間 (Time)</span>
        <span>價格 (Price USDT)</span>
        <span className="text-right">數量 (Size BTC)</span>
        <span className="text-right">類型 (Type)</span>
      </div>

      {/* 滾動 Viewport */}
      <div
        ref={viewportRef}
        className="w-full overflow-y-auto custom-scrollbar relative select-none"
        style={{ height: `${VIEWPORT_HEIGHT}px`, contain: 'layout size' }}
      >
        {/* 1px 置頂哨兵 */}
        <div
          ref={sentinelRef}
          className="absolute top-0 left-0 w-full h-[1px] invisible pointer-events-none"
        />

        {/* 滾動跑道 */}
        <div
          ref={runwayRef}
          className="relative w-full overflow-hidden"
          style={{ height: '0px' }}
        />
      </div>

      {/* 「最新成交」懸浮解凍按鈕 */}
      {!isAtTop && (
        <button
          onClick={handleScrollToTop}
          className="absolute bottom-4 right-4 z-10 bg-[#089981] hover:bg-[#0a8471] text-white text-[11px] font-bold py-1.5 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-all duration-200 active:scale-95 animate-fade-in"
        >
          <span>▲ 最新成交</span>
        </button>
      )}
    </div>
  );
}
