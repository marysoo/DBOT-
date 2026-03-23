import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Square, 
  Settings, 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  CheckCircle2, 
  LogOut,
  ChevronRight,
  History,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DerivService, Tick } from './services/derivService';

// --- Types ---
interface BotStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  currentStake: number;
  balance: number;
}

interface BotLog {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'trade';
}

export default function App() {
  // --- State ---
  const [apiToken, setApiToken] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [symbols, setSymbols] = useState<any[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('R_100'); 
  const [stake, setStake] = useState(0.35);
  const [takeProfit, setTakeProfit] = useState(2); // Lower TP for $5 capital
  const [stopLoss, setStopLoss] = useState(4); // Tight SL for $5 capital
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.1); // Optimized for ~95% payout
  const [maxMartingaleSteps, setMaxMartingaleSteps] = useState(3); // Safety for $5 capital
  
  // --- Over-trading Protection ---
  const [maxTradesPerSession, setMaxTradesPerSession] = useState(20);
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [tradesThisSession, setTradesThisSession] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<string | null>(null);
  
  const [stats, setStats] = useState<BotStats>({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0,
    currentStake: 0.35,
    balance: 0,
  });

  const [logs, setLogs] = useState<BotLog[]>([]);
  const [lastDigits, setLastDigits] = useState<number[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // --- Refs ---
  const derivRef = useRef<DerivService | null>(null);
  const statsRef = useRef<BotStats>(stats);
  const lastDigitsRef = useRef<number[]>([]);
  const isBotRunningRef = useRef(false);
  const isTradingRef = useRef(false);
  const currentStepRef = useRef(0);

  // Sync refs with state
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { lastDigitsRef.current = lastDigits; }, [lastDigits]);
  useEffect(() => { isBotRunningRef.current = isBotRunning; }, [isBotRunning]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  // Cooldown Timer Effect
  useEffect(() => {
    if (!cooldownEndTime) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const diff = cooldownEndTime - now;

      if (diff <= 0) {
        setCooldownEndTime(null);
        setCooldownRemaining(null);
        clearInterval(timer);
        addLog('Cooldown period ended. You can trade again.', 'success');
      } else {
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        setCooldownRemaining(`${minutes}m ${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownEndTime]);

  // --- Helpers ---
  const addLog = (message: string, type: BotLog['type'] = 'info') => {
    const newLog: BotLog = {
      id: Math.random().toString(36).substr(2, 9),
      time: new Date().toLocaleTimeString(),
      message,
      type,
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  };

  const connectDeriv = async () => {
    if (!apiToken) {
      addLog('Please enter an API Token', 'error');
      return;
    }

    setIsConnecting(true);
    try {
      const deriv = new DerivService();
      await deriv.connect();
      const auth = await deriv.authorize(apiToken);
      
      if (auth.error) {
        addLog(`Auth Error: ${auth.error.message}`, 'error');
        deriv.disconnect();
      } else {
        derivRef.current = deriv;
        setIsAuthorized(true);
        const initialStake = Math.round(stake * 100) / 100;
        setStats(prev => ({ ...prev, balance: auth.authorize.balance, currentStake: initialStake }));
        addLog(`Connected as ${auth.authorize.fullname}`, 'success');
        
        const syms = await deriv.getActiveSymbols();
        if (syms.active_symbols) {
          const volSymbols = syms.active_symbols.filter((s: any) => 
            s.market === 'synthetic_index' && s.submarket === 'random_index'
          );
          setSymbols(volSymbols);
        }
      }
    } catch (err) {
      addLog('Connection failed', 'error');
    } finally {
      setIsConnecting(false);
    }
  };

  const startBot = () => {
    if (!isAuthorized || !derivRef.current) return;
    
    // Over-trading Check
    if (cooldownEndTime && Date.now() < cooldownEndTime) {
      addLog(`Over-trading protection active. Please wait ${cooldownRemaining} before trading again.`, 'error');
      return;
    }

    // Capital Check
    if (stats.balance < stake) {
      addLog('Insufficient balance to start', 'error');
      return;
    }

    setIsBotRunning(true);
    setCurrentStep(0);
    setTradesThisSession(0);
    const initialStake = Math.round(stake * 100) / 100;
    setStats(prev => ({ ...prev, currentStake: initialStake }));
    addLog(`Bot started. Capital: $${stats.balance.toFixed(2)} | Target: +$${takeProfit}`, 'info');

    derivRef.current.subscribeTicks(selectedSymbol, handleTick);
  };

  const stopBot = () => {
    setIsBotRunning(false);
    derivRef.current?.unsubscribeTicks(selectedSymbol);
    addLog('Bot stopped', 'info');
  };

  const disconnectDeriv = () => {
    derivRef.current?.disconnect();
    derivRef.current = null;
    setIsAuthorized(false);
    setIsBotRunning(false);
    addLog('Disconnected', 'info');
  };
  
  const resetStats = () => {
    if (isBotRunning) return;
    
    setStats(prev => ({
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      currentStake: stake,
      balance: prev.balance,
    }));
    setLogs([]);
    setLastDigits([]);
    setCurrentStep(0);
    addLog('Session stats reset', 'info');
  };

  const handleTick = async (tick: any) => {
    const symbolInfo = symbols.find(s => s.symbol === selectedSymbol);
    const pipSize = symbolInfo?.pip_size || 0;
    const lastDigit = parseInt(tick.quote.toFixed(pipSize).slice(-1));

    const newDigits = [...lastDigitsRef.current, lastDigit].slice(-10);
    setLastDigits(newDigits);
    lastDigitsRef.current = newDigits;

    if (!isBotRunningRef.current || isTradingRef.current) return;

    // Pro Strategy: Look for 4 consecutive instead of 3 to reduce false signals
    const last4 = newDigits.slice(-4);
    if (last4.length < 4) return;

    const allOdd = last4.every(d => d % 2 !== 0);
    const allEven = last4.every(d => d % 2 === 0);

    let tradeType: 'DIGITEVEN' | 'DIGITODD' | null = null;
    
    if (allOdd) {
      addLog('Strategy: 4 Odds detected. Counter-trading EVEN.', 'info');
      tradeType = 'DIGITEVEN';
    } else if (allEven) {
      addLog('Strategy: 4 Evens detected. Counter-trading ODD.', 'info');
      tradeType = 'DIGITODD';
    }

    if (tradeType) {
      executeTrade(tradeType);
    }
  };

  const executeTrade = async (type: 'DIGITEVEN' | 'DIGITODD') => {
    if (isTradingRef.current || !derivRef.current) return;
    isTradingRef.current = true;

    const currentStake = statsRef.current.currentStake;
    
    // Safety check for $5 capital
    if (currentStake > statsRef.current.balance) {
      addLog(`Insufficient balance for next stake ($${currentStake.toFixed(2)})`, 'error');
      stopBot();
      isTradingRef.current = false;
      return;
    }

    addLog(`Trade #${statsRef.current.totalTrades + 1}: ${type} | Stake: $${currentStake.toFixed(2)}`, 'trade');

    try {
      const result = await derivRef.current.placeTrade(selectedSymbol, currentStake, type);
      
      if (result.isWin) {
        addLog(`Win! +$${result.profit.toFixed(2)}`, 'success');
        setCurrentStep(0);
        setStats(prev => ({
          ...prev,
          wins: prev.wins + 1,
          totalTrades: prev.totalTrades + 1,
          totalProfit: prev.totalProfit + result.profit,
          balance: prev.balance + result.profit,
          currentStake: stake,
        }));
        setTradesThisSession(prev => prev + 1);
      } else {
        addLog(`Loss. -$${Math.abs(result.profit).toFixed(2)}`, 'error');
        const nextStep = currentStepRef.current + 1;
        
        if (nextStep >= maxMartingaleSteps) {
          addLog('Max Martingale steps reached. Resetting to base stake.', 'info');
          setCurrentStep(0);
          setStats(prev => ({
            ...prev,
            losses: prev.losses + 1,
            totalTrades: prev.totalTrades + 1,
            totalProfit: prev.totalProfit + result.profit,
            balance: prev.balance + result.profit,
            currentStake: stake,
          }));
          setTradesThisSession(prev => prev + 1);
        } else {
          setCurrentStep(nextStep);
          setStats(prev => {
            const nextStake = Math.round(prev.currentStake * martingaleMultiplier * 100) / 100;
            return {
              ...prev,
              losses: prev.losses + 1,
              totalTrades: prev.totalTrades + 1,
              totalProfit: prev.totalProfit + result.profit,
              balance: prev.balance + result.profit,
              currentStake: nextStake,
            };
          });
          setTradesThisSession(prev => prev + 1);
        }
      }

      // Over-trading Check
      if (tradesThisSession + 1 >= maxTradesPerSession) {
        const endTime = Date.now() + cooldownMinutes * 60000;
        setCooldownEndTime(endTime);
        stopBot();
        addLog(`OVER-TRADING DETECTED! Session limit of ${maxTradesPerSession} trades reached. Bot stopped for ${cooldownMinutes} minutes.`, 'error');
      }

      // TP/SL Logic
      const currentProfit = statsRef.current.totalProfit;
      if (currentProfit >= takeProfit) {
        addLog(`Target Profit Reached: +$${currentProfit.toFixed(2)}`, 'success');
        stopBot();
      } else if (currentProfit <= -stopLoss) {
        addLog(`Stop Loss Reached: -$${Math.abs(currentProfit).toFixed(2)}`, 'error');
        stopBot();
      }

    } catch (err: any) {
      addLog(`Trade Error: ${err.message}`, 'error');
    } finally {
      isTradingRef.current = false;
    }
  };

  // --- Render ---
  return (
    <div className="min-h-screen bg-[#0e1117] text-[#e6edf3] font-sans selection:bg-[#1f6feb] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#30363d] bg-[#161b22] px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1f6feb] rounded-xl flex items-center justify-center shadow-lg shadow-[#1f6feb]/20">
            <Zap className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Deriv Pro Bot</h1>
            <p className="text-xs text-[#8b949e] font-mono">v2.0.0 • Micro-Account Growth Mode</p>
          </div>
        </div>
        
        {isAuthorized && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-[#8b949e] uppercase tracking-wider font-semibold">Balance</p>
              <p className="text-lg font-mono font-bold text-[#3fb950]">${stats.balance.toFixed(2)}</p>
            </div>
            <button 
              onClick={disconnectDeriv}
              className="p-2 hover:bg-[#30363d] rounded-lg transition-colors text-[#f85149]"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Controls & Settings */}
        <div className="lg:col-span-4 space-y-6">
          
          {cooldownEndTime && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#f85149]/10 border border-[#f85149]/30 p-5 rounded-2xl flex items-start gap-4 shadow-xl shadow-[#f85149]/5"
            >
              <div className="w-10 h-10 bg-[#f85149]/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertCircle className="text-[#f85149] w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#f85149] uppercase tracking-wider">Over-trading Protection</h3>
                <p className="text-xs text-[#8b949e] mt-1 leading-relaxed">
                  Session limit of <span className="text-white font-bold">{maxTradesPerSession} trades</span> reached. 
                  Trading is locked for <span className="text-white font-mono font-bold">{cooldownRemaining}</span> to prevent emotional trading.
                </p>
              </div>
            </motion.div>
          )}

          {/* Auth Card */}
          <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-2 bg-[#1c2128]">
              <ShieldCheck className="w-4 h-4 text-[#1f6feb]" />
              <h2 className="font-semibold text-sm uppercase tracking-wide">Authentication</h2>
            </div>
            <div className="p-5 space-y-4">
              {!isAuthorized ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[#8b949e] ml-1">API Token</label>
                    <input 
                      type="password" 
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                      placeholder="Enter your Deriv API Token"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 transition-all"
                    />
                  </div>
                  <button 
                    onClick={connectDeriv}
                    disabled={isConnecting}
                    className="w-full bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1f6feb]/10"
                  >
                    {isConnecting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>Connect Account</>
                    )}
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-[#3fb950]/10 border border-[#3fb950]/20 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-[#3fb950]" />
                  <div className="text-sm">
                    <p className="font-semibold text-[#3fb950]">Authenticated</p>
                    <p className="text-xs text-[#8b949e]">Ready to trade</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Settings Card */}
          <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-2 bg-[#1c2128]">
              <Settings className="w-4 h-4 text-[#1f6feb]" />
              <h2 className="font-semibold text-sm uppercase tracking-wide">Bot Settings</h2>
            </div>
            <div className="p-5 space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs text-[#8b949e] ml-1">Trading Instrument</label>
                <select 
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  disabled={isBotRunning}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                >
                  {symbols.length > 0 ? (
                    symbols.map(s => (
                      <option key={s.symbol} value={s.symbol}>{s.display_name}</option>
                    ))
                  ) : (
                    <option value="R_100">Volatility 100 Index</option>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[#8b949e] ml-1">Initial Stake ($)</label>
                  <input 
                    type="number" 
                    value={stake}
                    onChange={(e) => setStake(parseFloat(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#8b949e] ml-1">Martingale (x)</label>
                  <input 
                    type="number" 
                    value={martingaleMultiplier}
                    onChange={(e) => setMartingaleMultiplier(parseFloat(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[#8b949e] ml-1">Max Steps</label>
                  <input 
                    type="number" 
                    value={maxMartingaleSteps}
                    onChange={(e) => setMaxMartingaleSteps(parseInt(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#8b949e] ml-1">Target Profit ($)</label>
                  <input 
                    type="number" 
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8b949e] ml-1">Stop Loss ($)</label>
                <input 
                  type="number" 
                  value={stopLoss}
                  onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                  disabled={isBotRunning}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                />
              </div>

              <div className="pt-2 flex gap-3">
                {!isBotRunning ? (
                  <>
                    <button 
                      onClick={startBot}
                      disabled={!isAuthorized}
                      className="flex-1 bg-[#3fb950] hover:bg-[#46c95a] disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#3fb950]/10"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      START BOT
                    </button>
                    <button 
                      onClick={resetStats}
                      disabled={!isAuthorized || isBotRunning}
                      className="p-3 bg-[#30363d] hover:bg-[#3d444d] disabled:opacity-50 text-[#8b949e] hover:text-white rounded-xl transition-all flex items-center justify-center shadow-sm"
                      title="Reset Session Stats"
                    >
                      <History className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={stopBot}
                    className="w-full bg-[#f85149] hover:bg-[#fa7970] text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#f85149]/10"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    STOP BOT
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Risk Management Card */}
          <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-2 bg-[#1c2128]">
              <ShieldCheck className="w-4 h-4 text-[#d29922]" />
              <h2 className="font-semibold text-sm uppercase tracking-wide">Risk Management</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[#8b949e] uppercase tracking-widest font-bold ml-1">Max Session Trades</label>
                  <input 
                    type="number" 
                    value={maxTradesPerSession}
                    onChange={(e) => setMaxTradesPerSession(Number(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d29922]/50 transition-all font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-[#8b949e] uppercase tracking-widest font-bold ml-1">Cooldown (Mins)</label>
                  <input 
                    type="number" 
                    value={cooldownMinutes}
                    onChange={(e) => setCooldownMinutes(Number(e.target.value))}
                    disabled={isBotRunning}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#d29922]/50 transition-all font-mono"
                  />
                </div>
              </div>
              <p className="text-[10px] text-[#8b949e] italic leading-relaxed">
                * Prevents emotional trading by locking the bot after a set number of trades.
              </p>
            </div>
          </section>
        </div>

        {/* Right Column: Stats & Logs */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard 
              label="Profit / Loss" 
              value={`$${stats.totalProfit.toFixed(2)}`} 
              icon={<Activity className="w-4 h-4" />}
              color={stats.totalProfit >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}
            />
            <StatCard 
              label="Next Stake" 
              value={`$${stats.currentStake.toFixed(2)}`} 
              icon={<Zap className="w-4 h-4" />}
              color="text-[#1f6feb]"
            />
            <StatCard 
              label="Wins" 
              value={stats.wins.toString()} 
              icon={<TrendingUp className="w-4 h-4" />}
              color="text-[#3fb950]"
            />
            <StatCard 
              label="Losses" 
              value={stats.losses.toString()} 
              icon={<TrendingDown className="w-4 h-4" />}
              color="text-[#f85149]"
            />
          </div>

          {/* Visualizer & Logs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Digit Visualizer */}
            <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden flex flex-col h-[400px]">
              <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#1c2128]">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#1f6feb]" />
                  <h2 className="font-semibold text-sm uppercase tracking-wide">Last Digits</h2>
                </div>
                <div className="flex gap-1">
                  {lastDigits.slice(-4).map((d, i) => (
                    <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${d % 2 === 0 ? 'bg-[#3fb950]/20 text-[#3fb950]' : 'bg-[#f85149]/20 text-[#f85149]'}`}>
                      {d % 2 === 0 ? 'E' : 'O'}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex-1 p-6 flex flex-col items-center justify-center gap-8">
                <div className="flex gap-3">
                  <AnimatePresence mode="popLayout">
                    {lastDigits.slice(-5).map((digit, idx) => (
                      <motion.div
                        key={`${idx}-${digit}`}
                        initial={{ scale: 0.5, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.5, opacity: 0, y: -20 }}
                        className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border-2 ${
                          digit % 2 === 0 
                            ? 'bg-[#3fb950]/10 border-[#3fb950]/30 text-[#3fb950]' 
                            : 'bg-[#f85149]/10 border-[#f85149]/30 text-[#f85149]'
                        }`}
                      >
                        {digit}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                
                <div className="text-center space-y-2">
                  <p className="text-xs text-[#8b949e] uppercase tracking-widest font-semibold">Pro Strategy</p>
                  <div className="flex flex-col items-center gap-2 text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#f85149]" />
                      <span>4 Odds &rarr; Bet Even</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-[#3fb950]" />
                      <span>4 Evens &rarr; Bet Odd</span>
                    </div>
                  </div>
                </div>

                {isBotRunning && (
                  <div className="flex items-center gap-2 text-[#1f6feb] animate-pulse">
                    <Activity className="w-4 h-4" />
                    <span className="text-xs font-mono">Analyzing ticks...</span>
                  </div>
                )}
              </div>
            </section>

            {/* Logs */}
            <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden flex flex-col h-[400px]">
              <div className="px-5 py-4 border-b border-[#30363d] flex items-center gap-2 bg-[#1c2128]">
                <Activity className="w-4 h-4 text-[#1f6feb]" />
                <h2 className="font-semibold text-sm uppercase tracking-wide">Activity Log</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px]">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[#484f58] italic">
                    No activity yet
                  </div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="flex gap-3 items-start group">
                      <span className="text-[#484f58] shrink-0">{log.time}</span>
                      <span className={`
                        ${log.type === 'success' ? 'text-[#3fb950]' : ''}
                        ${log.type === 'error' ? 'text-[#f85149]' : ''}
                        ${log.type === 'trade' ? 'text-[#1f6feb]' : ''}
                        ${log.type === 'info' ? 'text-[#8b949e]' : ''}
                      `}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 text-center border-t border-[#30363d] mt-12">
        <p className="text-xs text-[#8b949e]">
          Trading involves risk. This bot is for educational purposes only. 
          Past performance does not guarantee future results.
        </p>
      </footer>
    </div>
  );
}

function StatCard({ label, value, icon, color = 'text-[#e6edf3]' }: { label: string, value: string, icon: React.ReactNode, color?: string }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex flex-col gap-1 shadow-sm">
      <div className="flex items-center gap-2 text-[#8b949e]">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-xl font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}
