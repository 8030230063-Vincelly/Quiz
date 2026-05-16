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
  Zap
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
  const isSyncPaused = useRef(false);

  // Refs for chart data
  const fetchData = async () => {
    try {
      const endpoints = ['/api/dht', '/api/relays', '/api/logs'];
      const responses = await Promise.all(endpoints.map(e => fetch(e)));

      // Check if any response is not OK
      for (const res of responses) {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
      }

      const [dhtData, relayData, logData] = await Promise.all(responses.map(res => res.json()));

      setDht(dhtData.data);
      setConnectionStatus(prev => ({
        ...prev,
        esp: dhtData.espConnected,
        bot: dhtData.botStatus,
        api: true
      }));

      // Only update relays and sequence if user hasn't just clicked something
      if (!isSyncPaused.current) {
        setRelays(relayData.relays);
        setSequenceMode(relayData.sequence);
      }
      
      setLogs(logData.activity);
      setTelegramLogs(logData.telegram);

    } catch (error) {
      console.error('Fetch error:', error);
      setConnectionStatus(prev => ({ ...prev, api: false }));
    }
  };

  const toggleSequence = async (mode: number) => {
    const newMode = sequenceMode === mode ? 0 : mode;
    isSyncPaused.current = true; // Pause sync
    setSequenceMode(newMode); // Optimistic UI
    
    try {
      const res = await fetch(`/api/sequence/${newMode}`);
      if (res.ok) {
        addNotification(`Sequence changed to: ${newMode === 0 ? 'Normal' : newMode === 1 ? '1-2-3-4' : '4-3-2-1'}`);
      }
    } catch (err) {
      console.error('Sequence toggle error:', err);
    } finally {
      // Resume sync after 2 seconds
      setTimeout(() => { isSyncPaused.current = false; }, 2000);
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
    const newState = !relays[id] ? 'on' : 'off';
    isSyncPaused.current = true; // Pause sync
    setRelays(prev => ({ ...prev, [id]: !prev[id] })); // Optimistic UI update
    
    try {
      const res = await fetch(`/api/relay/${id}/${newState}`);
      if (res.ok) {
        addNotification(`Relay ${id} turned ${newState}`);
      }
    } catch (err) {
      console.error('Relay toggle error:', err);
    } finally {
      // Resume sync after 2 seconds
      setTimeout(() => { isSyncPaused.current = false; }, 2000);
    }
  };

  const startVoiceControl = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addNotification("Voice Recognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setVoiceResult(transcript);
      handleVoiceCommand(transcript);
    };

    recognition.start();
  };

  const handleVoiceCommand = (command: string) => {
    addNotification(`Command: "${command}"`);
    
    // Relay Commands
    const relayMatches = command.match(/lampu (\d+) (nyala|mati)/);
    if (relayMatches) {
      const id = parseInt(relayMatches[1]);
      const action = relayMatches[2];
      const currentState = relays[id];
      if ((action === 'nyala' && !currentState) || (action === 'mati' && currentState)) {
        toggleRelay(id);
      }
      return;
    }

    // Sequence Commands
    if (command.includes('variasi satu') || command.includes('variasi 1')) {
      toggleSequence(1);
    } else if (command.includes('variasi dua') || command.includes('variasi 2')) {
      toggleSequence(2);
    } else if (command.includes('berhenti variasi') || command.includes('matikan variasi')) {
      toggleSequence(0);
    } else if (command.includes('semua lampu nyala')) {
      [1,2,3,4].forEach(id => { if(!relays[id]) toggleRelay(id); });
    } else if (command.includes('semua lampu mati')) {
      [1,2,3,4].forEach(id => { if(relays[id]) toggleRelay(id); });
    }
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
              { icon: LayoutDashboard, label: 'Dashboard', active: true },
              { icon: Activity, label: 'Analytics' },
              { icon: MessageSquare, label: 'Security' },
            ].map((item, i) => (
              <button
                key={i}
                className={cn(
                  "sidebar-link w-full",
                  item.active ? "sidebar-link-active" : "sidebar-link-inactive"
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
              <h2 className="text-xl font-semibold">Device Overview</h2>
              <p className="text-slate-500 text-xs">Last sync: {format(currentTime, 'MMM dd, yyyy — HH:mm:ss')}</p>
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
          {/* Top Row: Metrics */}
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

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <MessageSquare size={24} />
                </div>
                <span className="text-[10px] font-bold text-amber-400 py-1 px-2 rounded bg-amber-500/10 uppercase">Active</span>
              </div>
              <div className="text-3xl font-bold mb-1">{telegramLogs.length}</div>
              <div className="text-xs text-slate-500 font-medium">Daily Telegram Triggers</div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Cpu size={24} />
                </div>
                <span className="text-[10px] font-bold text-indigo-400 py-1 px-2 rounded bg-indigo-500/10 uppercase">Healthy</span>
              </div>
              <div className="text-3xl font-bold mb-1">99.8%</div>
              <div className="text-xs text-slate-500 font-medium">ESP32 Connection Health</div>
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
