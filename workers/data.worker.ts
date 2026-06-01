import { CircularBuffer } from '../lib/circular-buffer';
import { CHART_CONSTANTS } from '../constants/chart';
import type {
  RawTickData,
  TickData,
  ConnectionStatus,
  WorkerCommand,
  WorkerMessage,
} from '../types/chart';

let socket: WebSocket | null = null;
const buffer = new CircularBuffer<TickData>(CHART_CONSTANTS.BUFFER_CAPACITY);
let reconnectDelay: number = CHART_CONSTANTS.INITIAL_RECONNECT_DELAY_MS;
let shouldReconnect = false;
let wsUrl: string = CHART_CONSTANTS.DEFAULT_WS_URL;

// 心跳與超時相關變數
let pingIntervalId: ReturnType<typeof setInterval> | null = null;
let pongTimeoutId: ReturnType<typeof setTimeout> | null = null;

function sendStatus(status: ConnectionStatus) {
  const msg: WorkerMessage = { type: 'STATUS', status };
  self.postMessage(msg);
}

function connect() {
  cleanupSocket();

  sendStatus(
    shouldReconnect && reconnectDelay > CHART_CONSTANTS.INITIAL_RECONNECT_DELAY_MS
      ? 'RECONNECTING'
      : 'CONNECTING',
  );

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      reconnectDelay = CHART_CONSTANTS.INITIAL_RECONNECT_DELAY_MS; // 成功連線後重置重連延遲
      sendStatus('CONNECTED');
      startHeartbeat();
    };

    socket.onmessage = (event) => {
      resetTimeout(); // 收到任何訊息，重置心跳超時檢測

      try {
        const rawData = JSON.parse(event.data);

        // 若為伺服器響應之 PONG 訊息，不寫入緩衝區
        if (rawData.type === 'PONG') {
          return;
        }

        // 驗證 Tick 數據格式並快取與發送
        const rawTick = rawData as RawTickData;
        if (rawTick.t && rawTick.p) {
          const price = parseFloat(rawTick.p);
          if (!isNaN(price)) {
            const tick: TickData = {
              time: rawTick.t,
              price,
            };
            buffer.push(tick);

            const msg: WorkerMessage = { type: 'TICK', data: tick };
            self.postMessage(msg);
          }
        }
      } catch {
        // 忽略 JSON 解析錯誤
      }
    };

    socket.onclose = () => {
      cleanupSocket();
      sendStatus('DISCONNECTED');
      if (shouldReconnect) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      if (socket) {
        socket.close();
      }
    };
  } catch {
    sendStatus('DISCONNECTED');
    if (shouldReconnect) {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect() {
  setTimeout(() => {
    if (shouldReconnect) {
      connect();
    }
  }, reconnectDelay);
  // 指數退避：延遲加倍，上限依常數設定
  reconnectDelay = Math.min(reconnectDelay * 2, CHART_CONSTANTS.MAX_RECONNECT_DELAY_MS);
}

function cleanupSocket() {
  stopHeartbeat();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  pingIntervalId = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'PING' }));

      // 啟動必須回應的心跳超時檢測
      pongTimeoutId = setTimeout(() => {
        if (socket) {
          socket.close();
        }
      }, CHART_CONSTANTS.PONG_TIMEOUT_MS);
    }
  }, CHART_CONSTANTS.PING_INTERVAL_MS);
}

function resetTimeout() {
  if (pongTimeoutId) {
    clearTimeout(pongTimeoutId);
    pongTimeoutId = null;
  }
}

function stopHeartbeat() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  resetTimeout();
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;

  switch (command.type) {
    case 'CONNECT':
      if (command.url) {
        wsUrl = command.url;
      }
      shouldReconnect = true;
      connect();
      break;

    case 'DISCONNECT':
      shouldReconnect = false;
      cleanupSocket();
      if (socket) {
        socket.close();
      }
      sendStatus('DISCONNECTED');
      break;

    case 'GET_DATA': {
      const msg: WorkerMessage = { type: 'HISTORY', data: buffer.toArray() };
      self.postMessage(msg);
      break;
    }

    case 'CLEAR': {
      buffer.clear();
      const msg: WorkerMessage = { type: 'CLEARED' };
      self.postMessage(msg);
      break;
    }
  }
};
