import React, { useState, useEffect, useRef } from 'react';
import { 
  Thermometer, 
  Droplets, 
  Power, 
  Activity, 
  MessageSquare, 
  Cpu, 
  Wifi, 
  Clock, 
  Bell, 
  LayoutDashboard, 
  Settings, 
  History,
  Menu,
  X,
  AlertCircle,
  ExternalLink,
  Github,
  Mic,
  MicOff,
  RotateCw,
  Zap,
  Network,
  ArrowRight,
  Database,
  Send,
  Smartphone,
  Laptop
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { cn } from './lib/utils';
import { format } from 'date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface SensorData {
  temp: number;
  humidity: number;
  lastUpdate: string;
}

interface LogEntry {
  time: string;
  message: string;
}

interface TelegramLog {
  time: string;
  user: string;
  command: string;
}

export default function App() {
  const [dht, setDht] = useState<SensorData>({ temp: 0, humidity: 0, lastUpdate: '' });
  const [relays, setRelays] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false, 4: false });
  const [sequenceMode, setSequenceMode] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [telegramLogs, setTelegramLogs] = useState<TelegramLog[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [voiceResult, setVoiceResult] = useState('');
  const [connectionStatus, setConnectionStatus] = useState({
    esp: false,
    api: false,
    bot: 'offline'
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: number; text: string }[]>([]);
  // Lock mechanism (per-relay and per-sequence) to prevent overwrite bouncing ("mati/hidup sendiri")
  const lastToggleTimeRef = useRef<Record<number, number>>({});
  const lastSequenceToggleTimeRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedNode, setSelectedNode] = useState('esp32');

  const [useDirectIp, setUseDirectIp] = useState<boolean>(() => {
    return localStorage.getItem('use_direct_ip') === 'true';
  });
  const [espLocalIp, setEspLocalIp] = useState<string>(() => {
    return localStorage.getItem('esp_local_ip') || '';
  });
  const [directConnected, setDirectConnected] = useState<boolean>(false);
  const [sequenceDelay, setSequenceDelay] = useState<number>(200);



  // Refs for chart data
  const fetchData = async () => {
    let dhtData = null;
    let relayData = null;
    let logData = null;
    let localSuccess = false;

    if (useDirectIp && espLocalIp) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout
        const localRes = await fetch(`http://${espLocalIp}/api/status`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (localRes.ok) {
          const localStatus = await localRes.json();
          dhtData = {
            data: {
              temp: localStatus.temp,
              humidity: localStatus.humidity,
              lastUpdate: new Date().toISOString()
            },
            espConnected: true,
            botStatus: 'online'
          };
          relayData = {
            sequence: localStatus.sequence,
            relays: localStatus.relays,
            sequenceDelay: localStatus.sequenceDelay
          };
          setDirectConnected(true);
          localSuccess = true;
        }
      } catch (err) {
        setDirectConnected(false);
      }
    }

    try {
      if (localSuccess) {
        // If local succeeded, we still grab the logs from cloud server in background
        const logsRes = await fetch('/api/logs');
        if (logsRes.ok) {
          logData = await logsRes.json();
        }
      } else {
        // Fallback or Cloud/Standard Mode
        setDirectConnected(false);
        const endpoints = ['/api/dht', '/api/relays', '/api/logs'];
        const responses = await Promise.all(endpoints.map(e => fetch(e)));

        for (const res of responses) {
          if (!res.ok) {
            throw new Error(`Server returned ${res.status} for ${res.url}`);
          }
        }

        const [cloudDht, cloudRelays, cloudLogs] = await Promise.all(responses.map(res => res.json()));
        dhtData = cloudDht;
        relayData = cloudRelays;
        logData = cloudLogs;
      }

      if (dhtData) {
        setDht(dhtData.data);
        setConnectionStatus(prev => ({
          ...prev,
          esp: dhtData.espConnected,
          bot: dhtData.botStatus,
          api: true
        }));
      }

      const now = Date.now();

      if (relayData) {
        // Only update sequence mode if the user has not interacted with it within the last 4 seconds
        if (now - lastSequenceToggleTimeRef.current > 4000) {
          setSequenceMode(relayData.sequence);
          if (relayData.sequenceDelay !== undefined) {
            setSequenceDelay(relayData.sequenceDelay);
          }
        }

        // Only update relays whose states haven't been recently toggled by the user
        setRelays(prev => {
          const nextRelays = { ...prev };
          let hasChanges = false;
          for (const [key, val] of Object.entries(relayData.relays)) {
            const rid = parseInt(key);
            const lastToggle = lastToggleTimeRef.current[rid] || 0;
            if (now - lastToggle > 4000) {
              if (nextRelays[rid] !== val) {
                nextRelays[rid] = val as boolean;
                hasChanges = true;
              }
            }
          }
          return hasChanges ? nextRelays : prev;
        });
      }

      if (logData) {
        setLogs(logData.activity);
        setTelegramLogs(logData.telegram);
      }

    } catch (error) {
      console.error('Fetch error:', error);
      // Only set API false if it's a persistent failure
      setConnectionStatus(prev => ({ ...prev, api: false }));
    }
  };

  const toggleSequence = async (mode: number) => {
    const newMode = sequenceMode === mode ? 0 : mode;
    lastSequenceToggleTimeRef.current = Date.now();
    setSequenceMode(newMode);

    try {
      const res = await fetch(`/api/sequence/${newMode}`);
      if (res.ok) {
        addNotification(`Variasi: ${newMode === 0 ? 'Mati' : newMode === 1 ? 'Pola 1-2-3-4' : 'Pola 4-3-2-1'}`);
      }
    } catch (err) {
      console.error('Sequence toggle error:', err);
    }
  };

  const adjustSequenceSpeed = async (delayVal: number) => {
    setSequenceDelay(delayVal);
    let success = false;

    // 1. Coba koneksi local LAN direct IP terlebih dahulu jika diaktifkan
    if (useDirectIp && espLocalIp) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout
        const localRes = await fetch(`http://${espLocalIp}/api/speed?delay=${delayVal}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (localRes.ok) {
          success = true;
          addNotification(`[Lokal Direct] Delay variasi: ${delayVal}ms (Respons Instan)`);
          
          // Kirim background sync ke cloud
          fetch(`/api/sequence-speed/${delayVal}`).catch(() => {});
        }
      } catch (err) {
        console.warn('Direct speed adjustment failed, falling back to cloud...', err);
      }
    }

    // 2. Fallback via Cloud API
    if (!success) {
      try {
        const res = await fetch(`/api/sequence-speed/${delayVal}`);
        if (res.ok) {
          addNotification(`Delay variasi diatur ke ${delayVal}ms`);
        }
      } catch (err) {
        console.error('Speed adjust error:', err);
      }
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/dht/history');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('History fetch error:', err);
    }
  };

  useEffect(() => {
    fetchData();
    fetchHistory();
    const interval = setInterval(fetchData, 3000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(clockInterval);
    };
  }, []);

  const toggleRelay = async (id: number) => {
    const currentState = relays[id];
    const newState = !currentState ? 'on' : 'off';
    
    // Protect immediately from update overwriting
    lastToggleTimeRef.current[id] = Date.now();
    setRelays(prev => ({ ...prev, [id]: !prev[id] }));

    let success = false;

    // 1. Coba koneksi local LAN direct IP terlebih dahulu jika diaktifkan
    if (useDirectIp && espLocalIp) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout
        const localRes = await fetch(`http://${espLocalIp}/api/relay?id=${id}&state=${newState}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (localRes.ok) {
          success = true;
          addNotification(`[Lokal Direct] Lampu ${id} seketika ${newState === 'on' ? 'MENYALA' : 'MATI'} (0ms delay)`);
          
          // Kirim background request ke backend API cloud untuk sinkronisasi state & trigger log aktivitas
          fetch(`/api/relay/${id}/${newState}`).catch(err => 
            console.warn('Background cloud sync failed', err)
          );
        }
      } catch (err) {
        console.warn('Direct LAN toggle gagal, otomatis fallback ke Cloud Vercel...', err);
      }
    }

    // 2. Fallback atau Standard Mode via Cloud API
    if (!success) {
      try {
        const res = await fetch(`/api/relay/${id}/${newState}`);
        if (res.ok) {
          addNotification(`Lampu ${id} sekarang ${newState === 'on' ? 'YANG MENYALA' : 'MATI'}`);
        }
      } catch (err) {
        console.error('Relay toggle error:', err);
        // Revert state jika request gagal total
        setRelays(prev => ({ ...prev, [id]: currentState }));
      }
    }
  };

  const setSequenceDirect = async (mode: number) => {
    lastSequenceToggleTimeRef.current = Date.now();
    setSequenceMode(mode);

    try {
      const res = await fetch(`/api/sequence/${mode}`);
      if (res.ok) {
        addNotification(`Variasi: ${mode === 0 ? 'Mati' : mode === 1 ? 'Pola 1-2-3-4' : 'Pola 4-3-2-1'}`);
      }
    } catch (err) {
      console.error('Sequence toggle error:', err);
    }
  };

  const startVoiceControl = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addNotification("Voice Recognition tidak didukung di browser ini!");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      addNotification("Mulai mendengarkan perintah suara...");
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.onerror = (event: any) => {
      console.error("Speech Recognition Error:", event.error);
      if (event.error === 'not-allowed') {
        addNotification("Izin mikrofon ditolak! Pastikan situs berjalan di HTTPS.");
      } else if (event.error === 'no-speech') {
        addNotification("Tidak terdengar suara.");
      } else {
        addNotification(`Gagal mengenali suara: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setVoiceResult(transcript);
      handleVoiceCommand(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const parseIndonesianNumber = (word: string): number | null => {
    if (word === '1' || word.includes('satu')) return 1;
    if (word === '2' || word.includes('dua')) return 2;
    if (word === '3' || word.includes('tiga')) return 3;
    if (word === '4' || word.includes('empat')) return 4;
    return null;
  };

  const handleVoiceCommand = (rawCommand: string) => {
    const command = rawCommand.toLowerCase().trim();
    addNotification(`Suara terdengar: "${command}"`);

    // 1. Control: semua relay (...) nyala / semua lampu (...) nyala
    if (
      command.includes('semua relay nyala') || 
      command.includes('semua lampu nyala') ||
      command.includes('semua relaynya nyala')
    ) {
      [1, 2, 3, 4].forEach(id => {
        const currentState = relays[id];
        if (!currentState) {
          toggleRelay(id);
        }
      });
      addNotification("Menghidupkan semua relay...");
      return;
    }

    // Control: semua relay (...) mati / semua lampu (...) mati
    if (
      command.includes('semua relay mati') || 
      command.includes('semua lampu mati') ||
      command.includes('semua relaynya mati')
    ) {
      [1, 2, 3, 4].forEach(id => {
        const currentState = relays[id];
        if (currentState) {
          toggleRelay(id);
        }
      });
      addNotification("Mematikan semua relay...");
      return;
    }

    // 2. Control: variasi 1/2 nyala/mati
    const variasiMatch = command.match(/variasi\s+(1|satu|2|dua)\s+(nyala|mati)/);
    if (variasiMatch) {
      const varNumStr = variasiMatch[1];
      const action = variasiMatch[2];
      const mode = (varNumStr === '1' || varNumStr === 'satu') ? 1 : 2;

      if (action === 'nyala') {
        setSequenceDirect(mode);
      } else {
        setSequenceDirect(0);
      }
      return;
    }

    // Fallback variasi direct checks
    if (command.includes('variasi 1 nyala') || command.includes('variasi satu nyala')) {
      setSequenceDirect(1);
      return;
    } else if (command.includes('variasi 1 mati') || command.includes('variasi satu mati')) {
      setSequenceDirect(0);
      return;
    } else if (command.includes('variasi 2 nyala') || command.includes('variasi dua nyala')) {
      setSequenceDirect(2);
      return;
    } else if (command.includes('variasi 2 mati') || command.includes('variasi dua mati')) {
      setSequenceDirect(0);
      return;
    }

    // 3. Control: relay (...) nyala/mati ATAU lampu (...) nyala/mati
    const relayMatch = command.match(/(relay|lampu)\s+(1|satu|2|dua|3|tiga|4|empat)\s+(nyala|mati)/);
    if (relayMatch) {
      const numWord = relayMatch[2];
      const action = relayMatch[3];
      const id = parseIndonesianNumber(numWord);

      if (id !== null) {
        const currentState = relays[id]; // true = ON, false = OFF
        const targetState = action === 'nyala';
        if (currentState !== targetState) {
          toggleRelay(id);
        } else {
          addNotification(`Relay ${id} sudah ${action === 'nyala' ? 'YANG MENYALA' : 'MATI'}`);
        }
        return;
      }
    }

    // Direct string detection as exact match helper backstop
    let foundRelayCmd = false;
    [1, 2, 3, 4].forEach(id => {
      const idWords = id === 1 ? ['1', 'satu'] : id === 2 ? ['2', 'dua'] : id === 3 ? ['3', 'tiga'] : ['4', 'empat'];
      idWords.forEach(word => {
        if (command.includes(`relay ${word} nyala`) || command.includes(`lampu ${word} nyala`)) {
          if (!relays[id]) toggleRelay(id);
          foundRelayCmd = true;
        } else if (command.includes(`relay ${word} mati`) || command.includes(`lampu ${word} mati`)) {
          if (relays[id]) toggleRelay(id);
          foundRelayCmd = true;
        }
      });
    });

    if (foundRelayCmd) return;

    addNotification(`Perintah suara tidak dikenali: "${command}"`);
  };

  const addNotification = (text: string) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  const chartData = {
    labels: history.map(h => format(new Date(h.time), 'HH:mm')),
    datasets: [
      {
        label: 'Suhu (°C)',
        data: history.map(h => h.temp),
        borderColor: '#f87171',
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Kelembaban (%)',
        data: history.map(h => h.humidity),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: { color: '#94a3b8', font: { family: 'Outfit' } }
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleFont: { family: 'Outfit' },
        bodyFont: { family: 'Outfit' },
      }
    },
    scales: {
      y: {
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
        ticks: { color: '#94a3b8' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8' }
      }
    }
  };

  return (
    <div className="min-h-screen flex text-white font-sans overflow-x-hidden">
      {/* Notifications */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass px-6 py-3 rounded-2xl flex items-center gap-3 border-l-4 border-l-blue-500 shadow-xl"
            >
              <Bell className="w-5 h-5 text-blue-400" />
              <span className="font-medium">{n.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sidebar Mobile Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" 
          />
        )}
      </AnimatePresence>

      {/* Sidebar Content */}
      <motion.aside 
        className={cn(
          "fixed top-0 left-0 bottom-0 w-72 bg-sidebar-bg border-r border-white/5 z-50 transition-all duration-500 ease-out lg:static lg:block",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="p-8 flex flex-col h-full">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Cpu className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">SMART<span className="text-indigo-400">IOT</span></h1>
            </div>
          </div>

          <nav className="flex-1 space-y-1">
            {[
              { icon: LayoutDashboard, id: 'Dashboard', label: 'Dashboard' },
              { icon: Activity, id: 'Analytics', label: 'Analytics' },
              { icon: MessageSquare, id: 'Security', label: 'Security' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={cn(
                  "sidebar-link w-full",
                  activeTab === item.id ? "sidebar-link-active" : "sidebar-link-inactive"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <footer className="pt-6 border-t border-white/5 mt-auto">
            <div className="p-4 rounded-xl bg-white/5 space-y-3">
              {[
                { label: 'ESP32 Node', status: connectionStatus.esp ? 'online' : 'offline' },
                { label: 'Telegram Bot', status: connectionStatus.bot },
                { label: 'Backend API', status: connectionStatus.api ? 'online' : 'offline' },
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">{s.label}</span>
                  <span className={cn(
                    "flex items-center gap-1.5",
                    s.status === 'online' ? "text-emerald-400" : "text-rose-400"
                  )}>
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full bg-current",
                      s.status === 'online' && "animate-pulse"
                    )} /> 
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          </footer>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto w-full bg-brand-bg">
        {/* Header */}
        <header className="h-20 border-b border-white/5 px-8 flex items-center justify-between sticky top-0 z-30 bg-brand-bg/80 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-10 h-10 glass flex items-center justify-center rounded-xl"
            >
              <Menu size={20} />
            </button>
             <div>
              <h2 className="text-xl font-semibold">
                {activeTab === 'Dashboard' && 'Device Overview'}
                {activeTab === 'Analytics' && 'Suhu & Kelembaban Analytics'}
                {activeTab === 'Security' && 'Keamanan & Pengawasan'}
              </h2>
              <p className="text-slate-500 text-xs">
                {activeTab === 'Dashboard' ? `Last sync: ${format(currentTime, 'MMM dd, yyyy — HH:mm:ss')}` : 'Sistem Smart Home IoT ESP32'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={startVoiceControl}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300",
                isListening ? "bg-red-500 animate-pulse shadow-lg shadow-red-500/20" : "glass hover:bg-white/10"
              )}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <div className="text-right mr-4 hidden sm:block">
              <div className="text-sm font-mono text-indigo-300">{format(currentTime, 'HH:mm:ss')}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-widest">Home Station, ID</div>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors">
              <Bell size={18} className="text-slate-400" />
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/20"></div>
          </div>
        </header>

        <div className="p-8 space-y-6 max-w-7xl mx-auto">
          {activeTab === 'Dashboard' && (
            <>
              {/* Top Row: Metrics (Temp, Humidity, and Direct LAN Panel next to each other) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <Thermometer size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 py-1 px-2 rounded bg-emerald-500/10 uppercase">Optimal</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">{dht.temp}°C</div>
                  <div className="text-xs text-slate-500 font-medium">Ambient Temperature (DHT11)</div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                      <Droplets size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-blue-400 py-1 px-2 rounded bg-blue-500/10 uppercase">Stable</span>
                  </div>
                  <div className="text-3xl font-bold mb-1">{dht.humidity}%</div>
                  <div className="text-xs text-slate-500 font-medium">Air Humidity Index</div>
                </div>

                {/* Direct LAN Setup Panel */}
                <div className="lg:col-span-2 bg-gradient-to-br from-indigo-950/40 via-slate-900/40 to-slate-900/40 border border-white/10 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm flex flex-col justify-between min-h-[140px]">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 relative">
                        <span className={cn(
                          "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                          directConnected ? "bg-emerald-400" : "bg-rose-400"
                        )} />
                        <span className={cn(
                          "relative inline-flex rounded-full h-2 w-2",
                          directConnected ? "bg-emerald-500" : "bg-rose-500"
                        )} />
                      </span>
                      <h3 className="text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                        ⚡ Koneksi Lokal Direct LAN
                      </h3>
                    </div>

                    {/* Switch Mode toggle */}
                    <div className="flex items-center gap-2 bg-black/30 px-3 py-1.5 rounded-xl border border-white/5 self-start sm:self-auto">
                      <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap">Mode Direct IP:</span>
                      <button
                        onClick={() => {
                          const nextVal = !useDirectIp;
                          setUseDirectIp(nextVal);
                          localStorage.setItem('use_direct_ip', String(nextVal));
                          addNotification(`Mode Direct IP: ${nextVal ? 'DIKENDALIKAN LOKAL' : 'KEMBALI KE CLOUD'}`);
                        }}
                        className={cn(
                          "w-10 h-5 rounded-full relative transition-all duration-300 border border-white/10",
                          useDirectIp ? "bg-indigo-600" : "bg-slate-800"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-all duration-300 shadow",
                          useDirectIp ? "translate-x-5" : "translate-x-0"
                        )} />
                      </button>
                    </div>
                  </div>

                  {/* Input IP and Test Button */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2 text-[10px] text-indigo-500/60 font-mono">http://</span>
                      <input
                        type="text"
                        placeholder="IP ESP32 (e.g. 192.168.1.15)"
                        value={espLocalIp}
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          setEspLocalIp(val);
                          localStorage.setItem('esp_local_ip', val);
                        }}
                        className="w-full pl-12 pr-3 py-1.5 text-xs bg-slate-950/60 border border-white/10 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-indigo-200 font-mono tracking-wide"
                      />
                    </div>
                    <button
                      onClick={() => {
                        fetchData();
                        addNotification("Mengetes koneksi lokal ke ESP32...");
                      }}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-indigo-600/20 active:scale-95 whitespace-nowrap"
                    >
                      <RotateCw size={12} className={cn(useDirectIp && "animate-spin")} />
                      <span>Tes IP</span>
                    </button>
                  </div>

                  {/* Connection Status Footer */}
                  <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1.5 border-t border-white/5 pt-1.5">
                    <span className="font-semibold text-indigo-400 font-mono">Status LAN:</span>
                    <span className="truncate">{directConnected ? `🟢 Terhubung langsung ke http://${espLocalIp} (~3ms)` : `🔴 Belum terhubung (Gunakan input IP & pastikan satu WiFi)`}</span>
                  </div>
                </div>
              </div>

              {/* Main Visual Area */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6 h-[400px] flex flex-col">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-sm font-medium">Environmental History</h3>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="w-2 h-2 rounded-full bg-indigo-500" /> Temp
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="w-2 h-2 rounded-full bg-blue-400" /> Hum
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 w-full min-h-0">
                    <Line data={chartData} options={chartOptions} />
                  </div>
                </div>

                <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4 h-auto lg:h-[400px]">
                  {[1, 2, 3, 4].map(id => (
                    <div 
                      key={id}
                      onClick={() => toggleRelay(id)}
                      className={cn(
                        "rounded-2xl p-4 flex flex-col justify-between transition-all duration-300 cursor-pointer border",
                        relays[id] && sequenceMode === 0
                          ? "bg-indigo-500/10 border-indigo-500/30 text-white" 
                          : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10",
                        sequenceMode !== 0 && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span className={cn("text-xs font-semibold", relays[id] ? "text-indigo-400" : "text-slate-500")}>RELAY {id}</span>
                        <div className={cn(
                          "w-8 h-4 rounded-full relative transition-colors duration-300",
                          relays[id] ? "bg-indigo-500" : "bg-slate-700"
                        )}>
                          <motion.div 
                            animate={{ x: relays[id] ? 16 : 0 }}
                            className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full shadow-sm"
                          />
                        </div>
                      </div>
                      <div className="mt-auto">
                        <p className="text-[15px] font-bold leading-tight">
                          {id === 1 ? 'Living Room' : id === 2 ? 'Main Gate' : id === 3 ? 'Cooling Fan' : 'Sprinklers'}
                        </p>
                        <p className={cn("text-[10px] font-medium", relays[id] ? "text-indigo-400" : "text-slate-500")}>
                          {relays[id] ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Sequence Controls */}
                  <div 
                    onClick={() => toggleSequence(1)}
                    className={cn(
                      "rounded-2xl p-4 flex flex-col justify-between transition-all duration-300 cursor-pointer border",
                      sequenceMode === 1 
                        ? "bg-purple-500/20 border-purple-500/40 text-purple-200" 
                        : "bg-white/5 border-white/10 text-slate-400"
                    )}
                  >
                    <div className="flex justify-between">
                      <Zap size={16} className={sequenceMode === 1 ? "text-purple-400" : "text-slate-600"} />
                      <RotateCw size={14} className={cn(sequenceMode === 1 && "animate-spin")} />
                    </div>
                    <div className="mt-auto">
                      <p className="text-[13px] font-bold">Seq: 1-2-3-4</p>
                      <p className="text-[9px] opacity-60">Variation Mode 1</p>
                    </div>
                  </div>

                  <div 
                    onClick={() => toggleSequence(2)}
                    className={cn(
                      "rounded-2xl p-4 flex flex-col justify-between transition-all duration-300 cursor-pointer border",
                      sequenceMode === 2 
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-200" 
                        : "bg-white/5 border-white/10 text-slate-400"
                    )}
                  >
                    <div className="flex justify-between">
                      <Zap size={16} className={sequenceMode === 2 ? "text-amber-400" : "text-slate-600"} />
                      <RotateCw size={14} className={cn(sequenceMode === 2 && "animate-spin")} />
                    </div>
                    <div className="mt-auto">
                      <p className="text-[13px] font-bold">Seq: 4-3-2-1</p>
                      <p className="text-[9px] opacity-60">Variation Mode 2</p>
                    </div>
                  </div>

                  {/* Sequence Speed Slider Card */}
                  <div className="col-span-2 sm:col-span-3 bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col justify-between gap-3 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity size={16} className="text-indigo-400 animate-pulse" />
                        <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">⚡ Delay Kecepatan: {sequenceDelay} ms</span>
                      </div>
                      <span className="text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-2 py-0.5 rounded-md">
                        {sequenceDelay <= 100 ? "Sangat Cepat 🔥" : sequenceDelay <= 250 ? "Cepat ⚡" : sequenceDelay <= 500 ? "Sedang 🟢" : "Lambat 🐢"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 w-full">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Hi-Speed</span>
                      <input 
                        type="range" 
                        min="50" 
                        max="1000" 
                        step="25"
                        value={sequenceDelay}
                        onChange={(e) => adjustSequenceSpeed(parseInt(e.target.value))}
                        className="flex-1 accent-indigo-500 h-1 rounded-lg cursor-pointer bg-slate-800 outline-none transition-all hover:accent-indigo-400"
                      />
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Slow-Mo</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-8">
                <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-6">Activity Monitor</h3>
                  <div className="space-y-4 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                    {logs.map((log, i) => (
                      <div key={i} className="flex gap-4 group items-center">
                        <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase">{format(new Date(log.time), 'HH:mm:ss')}</span>
                        <span className="text-[13px] text-slate-300 font-medium">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#1c1c22] border border-white/10 rounded-2xl p-5 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                      <MessageSquare size={16} className="text-white" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Telegram Stream</span>
                  </div>
                  <div className="bg-black/40 rounded-xl p-4 font-mono text-[11px] flex-1 overflow-y-auto space-y-3 border border-white/5">
                    {telegramLogs.slice(0, 5).map((log, i) => (
                      <div key={i} className="space-y-1">
                        <div className="text-indigo-400 font-bold flex justify-between">
                          <span>&gt; {log.command}</span>
                          <span className="text-[9px] text-slate-600">@{log.user}</span>
                        </div>
                        <div className="text-slate-500 pl-3 border-l border-white/5">Bot: Execution confirmed.</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'Analytics' && (
            <div className="space-y-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 h-[450px] flex flex-col">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-sm font-medium">Histori Suhu & Kelembaban (Detail)</h3>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" /> Temp
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-blue-400" /> Hum
                    </div>
                  </div>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Suhu Tertinggi</h4>
                  <p className="text-3xl font-bold text-red-400">{history.length > 0 ? Math.max(...history.map(h => h.temp)).toFixed(1) : dht.temp}°C</p>
                  <p className="text-[10px] text-slate-500 mt-2">Berdasarkan data sensor sesi aktif</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Kelembaban Maksimum</h4>
                  <p className="text-3xl font-bold text-blue-400">{history.length > 0 ? Math.max(...history.map(h => h.humidity)).toFixed(1) : dht.humidity}%</p>
                  <p className="text-[10px] text-slate-500 mt-2">Berdasarkan pembacaan DHT11</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status Kenyamanan</h4>
                  <p className="text-2xl font-bold text-emerald-400">Sangat Nyaman</p>
                  <p className="text-[10px] text-slate-500 mt-2">Sistem beroperasi pada parameter ideal</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Security' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-sm font-semibold mb-4 text-indigo-400">Voice Command Guide (Kontrol Suara)</h3>
                <p className="text-sm text-slate-400 mb-6">Gunakan mikrofon pada navigasi atas dan katakan command berikut dalam bahasa Indonesia:</p>
                
                <div className="space-y-4">
                  {[
                    { cmd: '"Lampu [1-4] nyala"', desc: 'Menghidupkan relay sesuai nomor (contoh: "Lampu 1 nyala")' },
                    { cmd: '"Lampu [1-4] mati"', desc: 'Mematikan relay sesuai nomor (contoh: "Lampu 3 mati")' },
                    { cmd: '"Semua lampu nyala"', desc: 'Menyalakan seluruh relay secara bersamaan' },
                    { cmd: '"Semua lampu mati"', desc: 'Mematikan semua relay secara instan' },
                    { cmd: '"Variasi satu / dua"', desc: 'Mengaktifkan mode pergantian otomatis (Sequence)' },
                    { cmd: '"Matikan variasi"', desc: 'Kembali ke mode kontrol normal/manual' }
                  ].map((item, id) => (
                    <div key={id} className="p-4 rounded-xl bg-white/5 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="font-mono text-indigo-300 font-semibold">{item.cmd}</span>
                      <span className="text-xs text-slate-400">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#1c1c22] border border-white/10 rounded-2xl p-5 flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <MessageSquare size={16} className="text-white" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Telegram Control Logs</span>
                </div>
                <div className="bg-black/40 rounded-xl p-4 font-mono text-[11px] flex-1 overflow-y-auto space-y-3 border border-white/5">
                  {telegramLogs.map((log, i) => (
                    <div key={i} className="space-y-1">
                      <div className="text-indigo-400 font-bold flex justify-between">
                        <span>&gt; {log.command}</span>
                        <span className="text-[9px] text-slate-600">@{log.user}</span>
                      </div>
                      <div className="text-slate-500 pl-3 border-l border-white/5">Bot: Execution confirmed.</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-8 py-10 mt-8 border-t border-white/5 text-center">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-[0.2em] mb-4">Secured SmartHome Infrastructure</p>
            <div className="flex justify-center gap-6 text-slate-500">
                <a href="#" className="hover:text-blue-400 transition-colors flex items-center gap-1">Documentation <ExternalLink size={12} /></a>
                <a href="#" className="hover:text-blue-400 transition-colors flex items-center gap-1">Privacy Policy <ExternalLink size={12} /></a>
                <a href="#" className="hover:text-blue-400 transition-colors flex items-center gap-1">API Status <ExternalLink size={12} /></a>
            </div>
        </div>
      </main>
    </div>
  );
}
