/**
 * 高頻交易圖表系統強型別定義與通訊協定
 */

/** 伺服器推送的原始 Tick 數據格式 */
export interface RawTickData {
  /** 時間戳記（毫秒） */
  t: number;
  /** 價格（字串格式，例如 "96000.00"） */
  p: string;
}

/** 處理後用於圖表庫與 UI 的資料格式 */
export interface TickData {
  /** 時標（以秒為單位的 Unix 時間戳，或遞增的邏輯 index） */
  time: number;
  /** 價格數值 */
  price: number;
}

/** 系統連線狀態聯集 */
export type ConnectionStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING'
  | 'ERROR'
  | 'FAILED';

// --- Web Worker 雙向通訊指令與訊息型別 ---

export type WorkerCommandType = 'CONNECT' | 'DISCONNECT' | 'GET_DATA' | 'CLEAR';

export interface ConnectCommand {
  type: 'CONNECT';
  url: string;
}

export interface DisconnectCommand {
  type: 'DISCONNECT';
}

export interface GetDataCommand {
  type: 'GET_DATA';
}

export interface ClearCommand {
  type: 'CLEAR';
}

/** 主執行緒傳送給 Worker 的指令聯集 */
export type WorkerCommand = ConnectCommand | DisconnectCommand | GetDataCommand | ClearCommand;

export type WorkerMessageType = 'STATUS' | 'TICK' | 'HISTORY' | 'CLEARED';

export interface StatusMessage {
  type: 'STATUS';
  status: ConnectionStatus;
}

export interface TickMessage {
  type: 'TICK';
  data: TickData;
}

export interface HistoryMessage {
  type: 'HISTORY';
  data: TickData[];
}

export interface ClearedMessage {
  type: 'CLEARED';
}

/** Worker 回傳給主執行緒的訊息聯集 */
export type WorkerMessage = StatusMessage | TickMessage | HistoryMessage | ClearedMessage;
