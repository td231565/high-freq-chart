import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
console.log('Mock WebSocket 伺服器已啟動，監聽 port 8080...');

let basePrice = 96000.0; // 模擬 BTC 價格

wss.on('connection', (ws) => {
  console.log('客戶端已連線');

  // 每隔 10ms 推送一次 (每秒 100 次)
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      // 隨機波動價格，範圍在 -2 到 +2 之間
      const change = (Math.random() - 0.5) * 4;
      basePrice += change;
      if (basePrice < 10000) basePrice = 96000.0; // 防止跌到過低

      const tick = {
        t: Date.now(),
        p: basePrice.toFixed(2),
      };

      ws.send(JSON.stringify(tick));
    }
  }, 10); // 10 毫秒

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch {
      // 忽略解析錯誤
    }
  });

  ws.on('close', () => {
    console.log('客戶端連線已斷開');
    clearInterval(interval);
  });

  ws.on('error', (err) => {
    console.error('Socket 錯誤:', err);
    clearInterval(interval);
  });
});
