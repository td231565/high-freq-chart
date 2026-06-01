/**
 * 高頻交易圖表系統常數配置
 */
export const CHART_CONSTANTS = {
  // --- WebSocket 連線設定 ---
  /** 預設 Mock WebSocket 伺服器網址 */
  DEFAULT_WS_URL: 'ws://localhost:8080',

  /** 心跳（PING）發送間隔時間（毫秒）*/
  PING_INTERVAL_MS: 30000, // 30 秒

  /** 心跳超時等待最大時間（毫秒）*/
  PONG_TIMEOUT_MS: 5000, // 5 秒

  /** 指數退避重連的初始延遲（毫秒）*/
  INITIAL_RECONNECT_DELAY_MS: 1000, // 1 秒

  /** 指數退避重連的最大延遲上限（毫秒）*/
  MAX_RECONNECT_DELAY_MS: 30000, // 30 秒

  // --- 資料快取設定 ---
  /** 環狀緩衝區（Circular Buffer）固定容量上限 */
  BUFFER_CAPACITY: 1000, // 快取 1000 筆

  // --- UI 與效能控制設定 ---
  /** 最新價格 DOM 節點文字更新的節流時間（毫秒）*/
  TEXT_UPDATE_THROTTLE_MS: 100, // 100 毫秒，維持人眼辨識上限並節省 CPU
} as const;
export type ChartConstants = typeof CHART_CONSTANTS;
export type ValueOf<T> = T[keyof T];
export type ChartConstantValue = ValueOf<ChartConstants>;
