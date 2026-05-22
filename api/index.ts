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
  sequenceMode: 0, // 0: off, 1: 1-2-3-4, 2: 4-3-2-1
  sequenceDelay: 200, // Speed delay in ms (lebih cepat, default 200ms)
  logs: [] as any[],
  telegramLogs: [] as any[],
  botStatus: isBotConfigured ? 'online' : 'unconfigured',
  activeChatId: null as number | null
};

// Initialize Telegram Bot
// NOTE: Polling is disabled on Vercel/Production because Serverless Functions 
// will kill the process. Use Webhooks for production bot logic.
let bot: TelegramBot | null = null;

// Helper to format time for Telegram messages
const formatTime = (date: Date | string) => {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      timeZone: 'Asia/Jakarta'
    }) + ' WIB';
  } catch (err) {
    return 'Waktu Tidak Valid';
  }
};

// Unified Telegram command processor
const processTelegramCommand = async (text: string, chat_id: number, username: string) => {
  const cleanText = text.toLowerCase().trim();
  
  // Save active Chat ID dynamically so we can send alerts to the active chat
  if (chat_id) {
    iotState.activeChatId = chat_id;
  }
  
  // Catat log Telegram untuk ditampilkan di Web UI Dashboard
  iotState.telegramLogs.unshift({
    time: new Date(),
    user: username,
    command: text,
    chat_id: chat_id
  });
  if (iotState.telegramLogs.length > 50) iotState.telegramLogs.pop();

  if (cleanText === '/start') {
    const welcomeMsg = 
      "👋 *Selamat datang di Bot SmartHome IoT ESP32!*\n\n" +
      "Berikut daftar perintah (command) utama yang bisa Anda gunakan:\n" +
      "🌡️ /dht - Cek kondisi suhu & kelembaban DHT11\n" +
      "📊 /status - Cek status sensor, relay, & koneksi lengkap\n" +
      "💡 /r1on s.d /r4on - Nyalakan Relay 1 s.d 4\n" +
      "📴 /r1off s.d /r4off - Matikan Relay 1 s.d 4\n" +
      "⚡ /v1 - Jalankan Pola Variasi 1 (1-2-3-4)\n" +
      "⚡ /v2 - Jalankan Pola Variasi 2 (4-3-2-1)\n" +
      "⏹️ /vstop - Hentikan pola variasi relay\n" +
      "🔄 /semuaon - Nyalakan semua relay sekaligus\n" +
      "❌ /semuaoff - Matikan semua relay & variasi\n\n" +
      "💡 _Format alternatif seperti /r1_on, /r1_off, /relay1on, atau /variasioff juga tetap didukung!_";
    await bot?.sendMessage(chat_id, welcomeMsg, { parse_mode: 'Markdown' });
  } else if (cleanText === '/dht') {
    const dhtMsg = 
      `🌡️ *Pembacaan Sensor DHT11:* \n\n` +
      `Suhu: *${iotState.dht.temp.toFixed(1)}°C*\n` +
      `Kelembaban: *${iotState.dht.humidity.toFixed(1)}%*\n\n` +
      `⏰ _Pembaruan terakhir: ${formatTime(iotState.dht.lastUpdate)}_`;
    await bot?.sendMessage(chat_id, dhtMsg, { parse_mode: 'Markdown' });
  } else if (cleanText === '/status') {
    const statusMsg = 
      `📊 *SMARTHOME STATUS REPORT* 📊\n\n` +
      `🌡️ Suhu: *${iotState.dht.temp.toFixed(1)}°C*\n` +
      `💧 Kelembaban: *${iotState.dht.humidity.toFixed(1)}%*\n\n` +
      `🔌 *Status Relay:*\n` +
      `- Relay 1: ${iotState.relays[1] ? '🟢 ON / MENYALA' : '🔴 OFF / MATI'}\n` +
      `- Relay 2: ${iotState.relays[2] ? '🟢 ON / MENYALA' : '🔴 OFF / MATI'}\n` +
      `- Relay 3: ${iotState.relays[3] ? '🟢 ON / MENYALA' : '🔴 OFF / MATI'}\n` +
      `- Relay 4: ${iotState.relays[4] ? '🟢 ON / MENYALA' : '🔴 OFF / MATI'}\n\n` +
      `🔄 Pola Variasi: *${iotState.sequenceMode === 0 ? 'Mati' : 'Pola ' + iotState.sequenceMode}*\n` +
      `⚡ Kecepatan Delay: *${iotState.sequenceDelay} ms*\n\n` +
      `🤖 Status Koneksi ESP32: *${iotState.espConnected ? 'Online 🟢' : 'Offline 🔴'}*`;
    await bot?.sendMessage(chat_id, statusMsg, { parse_mode: 'Markdown' });
  } else if (cleanText === '/semuaon') {
    [1,2,3,4].forEach(id => { iotState.relays[id as 1|2|3|4] = true; });
    addLog(`Telegram: All relays turned ON`);
    await bot?.sendMessage(chat_id, "🟢 Semua relay telah dinyalakan!");
  } else if (cleanText === '/semuaoff') {
    [1,2,3,4].forEach(id => { iotState.relays[id as 1|2|3|4] = false; });
    iotState.sequenceMode = 0;
    addLog(`Telegram: All relays turned OFF`);
    await bot?.sendMessage(chat_id, "🔴 Semua relay dan variasi telah dimatikan!");
  } else if (cleanText === '/v1' || cleanText === '/variasi1') {
    iotState.sequenceMode = 1;
    addLog(`Telegram: Sequence mode 1 started`);
    await bot?.sendMessage(chat_id, "🔄 Pola Variasi 1 (1-2-3-4) AKTIF!");
  } else if (cleanText === '/v2' || cleanText === '/variasi2') {
    iotState.sequenceMode = 2;
    addLog(`Telegram: Sequence mode 2 started`);
    await bot?.sendMessage(chat_id, "🔄 Pola Variasi 2 (4-3-2-1) AKTIF!");
  } else if (cleanText === '/vstop' || cleanText === '/variasioff') {
    iotState.sequenceMode = 0;
    addLog(`Telegram: Sequence mode stopped`);
    await bot?.sendMessage(chat_id, "⏹️ Pola Variasi TELAH DIMATIKAN!");
  } else {
    // Cek pola command relay individual seperti /relay1on atau /r1_on atau /r1_off
    const relayMatch = cleanText.match(/^\/(relay|r)([1-4])_?(on|off)$/);
    if (relayMatch) {
      const id = parseInt(relayMatch[2]) as 1|2|3|4;
      const action = relayMatch[3];
      const isOn = action === 'on';
      
      iotState.relays[id] = isOn;
      addLog(`Telegram: Relay ${id} turned ${action}`);
      await bot?.sendMessage(chat_id, `${isOn ? '🟢' : '🔴'} Relay ${id} sekarang *${action.toUpperCase()}*!`, { parse_mode: 'Markdown' });
    } else {
      await bot?.sendMessage(chat_id, "❓ Perintah tidak dikenali. Ketik /start untuk melihat daftar perintah.");
    }
  }
};

if (isBotConfigured && process.env.NODE_ENV !== 'test') {
  try {
    // Initialize standard TelegramBot with polling configuration options
    // but with autoStart: false so we do not initiate conflict errors on startup
    // until we have checked webhook status or cleared any active webhooks.
    bot = new TelegramBot(BOT_TOKEN as string, { polling: { autoStart: false } });
    iotState.botStatus = 'online';

    // Check if there is an active webhook on the Telegram server
    bot.getWebHookInfo()
      .then(async (info) => {
        if (info && info.url && info.url !== '') {
          console.log(`📡 [TELEGRAM] Active webhook found: ${info.url}. Skipping direct polling on startup.`);
          iotState.botStatus = 'online (webhook)';
        } else {
          console.log('ℹ️ [TELEGRAM] No active webhook found. Safe to start polling.');
          bot?.startPolling()
            .then(() => {
              console.log('🟢 [TELEGRAM] Polling started successfully.');
              iotState.botStatus = 'online (polling)';
            })
            .catch(err => {
              console.error('[TELEGRAM] Error starting polling:', err);
            });
        }
      })
      .catch((err) => {
        console.error('[TELEGRAM] Error checking webhook info, falling back to delete & poll:', err);
        // Fallback: clear and poll immediately
        bot?.deleteWebHook()
          .then(() => bot?.startPolling())
          .then(() => {
            console.log('🟢 [TELEGRAM] Polling started after fallback.');
            iotState.botStatus = 'online (polling)';
          })
          .catch(e => console.error('Fallback polling start failed:', e));
      });

    // Handle polling error gracefully to avoid infinite loops or freeze
    bot.on('polling_error', (error: any) => {
      const errMsg = error.message || '';
      if (errMsg.includes('409') || errMsg.includes('Conflict')) {
        console.log('ℹ️ [TELEGRAM] Polling conflict: Active webhook detected. Stopping polling.');
        bot?.stopPolling().catch(() => {});
        iotState.botStatus = 'online (webhook)';
      } else {
        console.error('[TELEGRAM] Polling Error:', error);
      }
    });

    // Listen for incoming messages from Telegram chats
    bot.on('message', (msg) => {
      if (msg.text) {
        processTelegramCommand(
          msg.text, 
          msg.chat.id, 
          msg.from?.username || msg.from?.first_name || 'Unknown'
        ).catch((err) => console.error("Error processing dev bot message:", err));
      }
    });
  } catch (err) {
    console.error('[TELEGRAM] Initialization error:', err);
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
    
    const targetChatId = CHAT_ID || iotState.activeChatId;
    if (bot && targetChatId) {
      bot.sendMessage(targetChatId, `Alert: Relay ${id} has been turned ${state === 'on' ? 'ON 🟢' : 'OFF 🔴'}`).catch(() => {});
    }
  }

  res.json({ status: 'ok', relay: id, state });
});

api.get('/relays', (req, res) => {
  lastRealData = Date.now(); // Heartbeat on relay poll too
  res.json({
    relays: iotState.relays,
    sequence: iotState.sequenceMode,
    sequenceDelay: iotState.sequenceDelay
  });
});

api.get('/sequence/:mode', (req, res) => {
  const mode = parseInt(req.params.mode);
  if ([0, 1, 2].includes(mode)) {
    iotState.sequenceMode = mode;
    addLog(`Sequence mode changed to: ${mode === 0 ? 'Off' : mode === 1 ? '1-2-3-4' : '4-3-2-1'}`);
    res.json({ status: 'ok', sequence: mode });
  } else {
    res.status(400).json({ error: 'Invalid mode' });
  }
});

api.get('/sequence-speed/:delay', (req, res) => {
  const delayVal = parseInt(req.params.delay);
  if (delayVal >= 50 && delayVal <= 2000) {
    iotState.sequenceDelay = delayVal;
    addLog(`Sequence speed changed to: ${delayVal}ms`);
    res.json({ status: 'ok', sequenceDelay: delayVal });
  } else {
    res.status(400).json({ error: 'Invalid delay bounds' });
  }
});

api.get('/logs', (req, res) => {
  res.json({
    activity: iotState.logs,
    telegram: iotState.telegramLogs
  });
});

api.get('/setup-webhook', async (req, res) => {
  if (!bot) {
    return res.status(400).json({ status: 'error', message: 'Telegram bot not configured or token missing' });
  }

  try {
    // If polling is currently active, stop it before switching to webhook mode
    if (bot.isPolling()) {
      console.log('ℹ️ [TELEGRAM] Active polling detected. Stopping polling for webhook transition...');
      await bot.stopPolling().catch(() => {});
    }

    const host = req.headers.host;
    // Determine proxy/original protocol, default to https for security of webhooks
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const webhookUrl = `${protocol}://${host}/api/telegram-webhook`;
    
    console.log(`📡 [TELEGRAM] Registering webhook endpoint to ${webhookUrl}...`);
    await bot.setWebHook(webhookUrl);
    
    iotState.botStatus = 'online (webhook)';
    res.json({ status: 'ok', webhookUrl, message: 'Telegram Webhook registered successfully! Bot switched to Webhook mode.' });
  } catch (error: any) {
    console.error('[TELEGRAM] Webhook registration failed:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Unknown error' });
  }
});

api.post('/telegram-webhook', async (req, res) => {
  try {
    const { message } = req.body;
    if (message && message.text) {
      await processTelegramCommand(
        message.text,
        message.chat.id,
        message.from?.username || message.from?.first_name || 'Unknown'
      );
    }
  } catch (error) {
    console.error('Error handling telegram webhook update:', error);
  }
  res.sendStatus(200);
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
