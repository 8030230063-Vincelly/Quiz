import express from 'express';
import path from 'path';
import { createServer } from 'vite';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Configurations
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const isBotConfigured = BOT_TOKEN && BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN';

// Mock IoT State
let iotState = {
  relays: {
    1: false,
    2: false,
    3: false,
    4: false
  },
  dht: {
    temp: 24,
    humidity: 60,
    lastUpdate: new Date()
  },
  espConnected: true,
  logs: [] as any[],
  telegramLogs: [] as any[],
  botStatus: 'offline'
};

// Initialize Telegram Bot if token exists
let bot: TelegramBot | null = null;
if (isBotConfigured) {
  try {
    bot = new TelegramBot(BOT_TOKEN as string, { polling: true });
    iotState.botStatus = 'online';
    
    bot.on('message', (msg) => {
      const text = msg.text;
      iotState.telegramLogs.unshift({
        time: new Date(),
        user: msg.from?.username || 'Unknown',
        command: text
      });
      if (iotState.telegramLogs.length > 50) iotState.telegramLogs.pop();

      if (text === '/start') {
        bot?.sendMessage(msg.chat.id, 'Welcome to SmartHome IoT Bot! Use buttons to control your home.');
      }
    });

    console.log('Telegram Bot connected');
  } catch (err) {
    console.error('Failed to initialize Telegram Bot:', err);
    iotState.botStatus = 'error';
  }
}

// Helper to add log
const addLog = (message: string) => {
  iotState.logs.unshift({
    time: new Date(),
    message
  });
  if (iotState.logs.length > 50) iotState.logs.pop();
};

// Simulation: Randomize DHT data every few seconds (Only if no real data received in last 30s)
let lastRealData = 0;
setInterval(() => {
  if (Date.now() - lastRealData > 30000 && iotState.espConnected) {
    iotState.dht.temp = Number((20 + Math.random() * 10).toFixed(1));
    iotState.dht.humidity = Number((40 + Math.random() * 40).toFixed(1));
    iotState.dht.lastUpdate = new Date();
  }
}, 3000);

// ESP32 Update Endpoint
app.post('/api/update-sensor', express.json(), (req, res) => {
  const { temp, humidity } = req.body;
  if (temp !== undefined && humidity !== undefined) {
    iotState.dht.temp = temp;
    iotState.dht.humidity = humidity;
    iotState.dht.lastUpdate = new Date();
    iotState.espConnected = true;
    lastRealData = Date.now();
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});

// API Endpoints
app.get('/api/dht', (req, res) => {
  res.json({
    status: 'ok',
    data: iotState.dht,
    espConnected: (Date.now() - lastRealData < 60000), // Anggap online jika ada data dalam 1 menit terakhir
    botStatus: isBotConfigured ? iotState.botStatus : 'unconfigured'
  });
});

app.get('/api/dht/history', (req, res) => {
  const now = Date.now();
  const history = Array.from({ length: 20 }, (_, i) => ({
    time: new Date(now - (19 - i) * 60000),
    temp: 22 + Math.random() * 5,
    humidity: 50 + Math.random() * 20
  }));
  res.json(history);
});

app.get('/api/relay/:id/:state', (req, res) => {
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

app.get('/api/relays', (req, res) => {
  res.json(iotState.relays);
});

app.get('/api/logs', (req, res) => {
  res.json({
    activity: iotState.logs,
    telegram: iotState.telegramLogs
  });
});

// Root API path helper
app.get('/api', (req, res) => {
  res.json({ status: 'API is running' });
});

// Explicitly handle 404 for API
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// IMPORTANT: Do NOT use app.listen in Vercel production
// Export the Express app for Vercel's serverless handler
export default app;

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Development server running on http://localhost:${PORT}`);
    });
  }
}

if (process.env.NODE_ENV !== 'production') {
  startServer();
}
