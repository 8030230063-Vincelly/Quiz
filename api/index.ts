import express from 'express';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Global Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Global Log: ${req.method} ${req.url}`);
  next();
});

// Configurations
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const isBotConfigured = !!(BOT_TOKEN && 
                          BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN' && 
                          BOT_TOKEN !== '');

// Mock IoT State (Note: Memory resets on Serverless Vercel)
let iotState = {
  relays: { 1: false, 2: false, 3: false, 4: false },
  dht: { temp: 24, humidity: 60, lastUpdate: new Date() },
  espConnected: false,
  logs: [] as any[],
  telegramLogs: [] as any[],
  botStatus: isBotConfigured ? 'online' : 'unconfigured'
};

// Initialize Telegram Bot
// NOTE: Polling is disabled on Vercel/Production because Serverless Functions 
// will kill the process. Use Webhooks for production bot logic.
let bot: TelegramBot | null = null;

if (isBotConfigured && process.env.NODE_ENV !== 'test') {
  try {
    // Only use polling in local development
    const usePolling = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
    
    bot = new TelegramBot(BOT_TOKEN as string, { polling: usePolling });
    iotState.botStatus = 'online';
    
    if (usePolling) {
      bot.on('message', (msg) => {
        const text = msg.text;
        iotState.telegramLogs.unshift({
          time: new Date(),
          user: msg.from?.username || 'Unknown',
          command: text
        });
        if (iotState.telegramLogs.length > 50) iotState.telegramLogs.pop();

        if (text === '/start') {
          bot?.sendMessage(msg.chat.id, 'Welcome to SmartHome IoT Bot!');
        }
      });
    }
  } catch (err) {
    iotState.botStatus = 'error';
  }
}

// Helper to add log
const addLog = (message: string) => {
  iotState.logs.unshift({ time: new Date(), message });
  if (iotState.logs.length > 50) iotState.logs.pop();
};

let lastRealData = 0;

// API Router
const api = express.Router();

// Logger for API
api.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

api.post('/update-sensor', (req, res) => {
  const { temp, humidity } = req.body;
  console.log('Sensor Update:', { temp, humidity });
  if (temp !== undefined && humidity !== undefined) {
    iotState.dht.temp = temp;
    iotState.dht.humidity = humidity;
    iotState.dht.lastUpdate = new Date();
    iotState.espConnected = true;
    lastRealData = Date.now();
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'Invalid data format' });
  }
});

api.get('/dht', (req, res) => {
  const isOnline = (Date.now() - lastRealData < 60000);
  res.json({
    status: 'ok',
    data: iotState.dht,
    espConnected: isOnline,
    botStatus: iotState.botStatus
  });
});

api.get('/dht/history', (req, res) => {
  const now = Date.now();
  const history = Array.from({ length: 20 }, (_, i) => ({
    time: new Date(now - (19 - i) * 60000),
    temp: 22 + Math.random() * 5,
    humidity: 50 + Math.random() * 20
  }));
  res.json(history);
});

api.get('/relay/:id/:state', (req, res) => {
  const { id, state } = req.params;
  const relayId = parseInt(id) as keyof typeof iotState.relays;
  const isOn = state === 'on';

  if (iotState.relays[relayId] !== undefined) {
    iotState.relays[relayId] = isOn;
    addLog(`Relay ${id} turned ${state}`);
    
    if (bot && CHAT_ID) {
      bot.sendMessage(CHAT_ID, `Alert: Relay ${id} has been turned ${state}`);
    }
  }

  res.json({ status: 'ok', relay: id, state });
});

api.get('/relays', (req, res) => {
  res.json(iotState.relays);
});

api.get('/logs', (req, res) => {
  res.json({
    activity: iotState.logs,
    telegram: iotState.telegramLogs
  });
});

api.get('/', (req, res) => {
  res.json({ status: 'API is running' });
});

// API mounting
app.use('/api', api);

// Production: Serve static files from root
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  
  // SPA Catch-all
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Export for Vercel
export default app;

// Local Development
if (process.env.NODE_ENV !== 'production') {
  const startDev = async () => {
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Dev: http://localhost:${PORT}`);
      });
    } catch (e) {
      console.error(e);
      app.listen(PORT);
    }
  };
  startDev();
}
