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
  Zap,
  RefreshCw,
  Clock,
  List
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DerivService, Tick } from './services/derivService';

// --- Types ---
interface SessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  duration: string;
  profit: number;
  trades: number;
  symbol: string;
}

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
  const [saveToken, setSaveToken] = useState(false);
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
  
  // --- Bot Selection ---
  const [botType, setBotType] = useState<'EVEN_ODD' | 'OVER_UNDER'>('EVEN_ODD');

  // --- Auto Trading ---
  const [isAutoTrading, setIsAutoTrading] = useState(false);
  const [currentSessionCount, setCurrentSessionCount] = useState(0);
  const [autoTradeHistory, setAutoTradeHistory] = useState<SessionSummary[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionStartProfit, setSessionStartProfit] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  
  const autoSymbols = ['1HZ25V', '1HZ30V', '1HZ100V'];

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
  const takeProfitRef = useRef(takeProfit);
  const stopLossRef = useRef(stopLoss);
  const stakeRef = useRef(stake);
  const martingaleMultiplierRef = useRef(martingaleMultiplier);
  const maxMartingaleStepsRef = useRef(maxMartingaleSteps);
  const botTypeRef = useRef(botType);
  const selectedSymbolRef = useRef(selectedSymbol);
  const symbolsRef = useRef(symbols);

  useEffect(() => {
    if (botType === 'OVER_UNDER' && symbols.length > 0) {
      const v100 = symbols.find(s => s.symbol === 'R_100' || s.symbol === '1HZ100V')?.symbol || 'R_100';
      if (!selectedSymbol.includes('100')) {
        setSelectedSymbol(v100);
      }
    }
  }, [botType, symbols, selectedSymbol]);

  // Sync refs with state
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { lastDigitsRef.current = lastDigits; }, [lastDigits]);
  useEffect(() => { isBotRunningRef.current = isBotRunning; }, [isBotRunning]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { takeProfitRef.current = takeProfit; }, [takeProfit]);
  useEffect(() => { stopLossRef.current = stopLoss; }, [stopLoss]);
  useEffect(() => { stakeRef.current = stake; }, [stake]);
  useEffect(() => { martingaleMultiplierRef.current = martingaleMultiplier; }, [martingaleMultiplier]);
  useEffect(() => { maxMartingaleStepsRef.current = maxMartingaleSteps; }, [maxMartingaleSteps]);
  useEffect(() => { botTypeRef.current = botType; }, [botType]);
  useEffect(() => { selectedSymbolRef.current = selectedSymbol; }, [selectedSymbol]);
  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);

  // Load saved token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('deriv_api_token');
    if (savedToken) {
      setApiToken(savedToken);
      setSaveToken(true);
    }
  }, []);

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
        addLog('Cooldown period ended.', 'success');
        
        // Auto-resume logic
        if (isAutoTrading) {
          addLog('Auto-Trading: Resuming next session...', 'info');
          setTimeout(() => startBot(), 2000); // Small delay to ensure state sync
        }
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
        if (saveToken) {
          localStorage.setItem('deriv_api_token', apiToken);
        } else {
          localStorage.removeItem('deriv_api_token');
        }
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
      setIsAutoTrading(false);
      return;
    }

    // Auto-trading symbol rotation
    let symbolToUse = selectedSymbol;
    if (isAutoTrading) {
      if (botType === 'EVEN_ODD') {
        symbolToUse = autoSymbols[currentSessionCount % autoSymbols.length];
        setSelectedSymbol(symbolToUse);
        addLog(`Auto-Trading: Session ${currentSessionCount + 1}/3 | Symbol: ${symbolToUse}`, 'info');
      } else {
        // Find best Volatility 100 symbol
        const v100 = symbols.find(s => s.symbol === 'R_100' || s.symbol === '1HZ100V')?.symbol || 'R_100';
        symbolToUse = v100;
        setSelectedSymbol(v100);
        addLog(`Auto-Trading: Session ${currentSessionCount + 1}/3 | Symbol: ${v100}`, 'info');
      }
    } else if (botType === 'OVER_UNDER') {
      if (!selectedSymbol.includes('100')) {
        const v100 = symbols.find(s => s.symbol === 'R_100' || s.symbol === '1HZ100V')?.symbol || 'R_100';
        setSelectedSymbol(v100);
        symbolToUse = v100;
      }
    }

    setIsBotRunning(true);
    isBotRunningRef.current = true;
    setCurrentStep(0);
    currentStepRef.current = 0;
    setTradesThisSession(0);
    setSessionStartTime(Date.now());
    setSessionStartProfit(stats.totalProfit);
    const initialStake = Math.round(stake * 100) / 100;
    setStats(prev => ({ ...prev, currentStake: initialStake }));
    addLog(`Bot started. Capital: $${stats.balance.toFixed(2)} | Target: +$${takeProfit}`, 'info');

    derivRef.current.subscribeTicks(symbolToUse, handleTick);
  };

  const stopBot = (reason = 'Manual') => {
    if (!isBotRunningRef.current) return;
    
    setIsBotRunning(false);
    isBotRunningRef.current = false;
    derivRef.current?.unsubscribeTicks(selectedSymbol);
    addLog(`Bot stopped: ${reason}`, 'info');

    // Handle Auto-Trading Session End
    if (isAutoTrading && sessionStartTime !== null) {
      const endTime = Date.now();
      const durationMs = endTime - sessionStartTime;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      
      const sessionProfit = stats.totalProfit - sessionStartProfit;
      
      const summary: SessionSummary = {
        id: Math.random().toString(36).substr(2, 9),
        startTime: new Date(sessionStartTime).toLocaleTimeString(),
        endTime: new Date(endTime).toLocaleTimeString(),
        duration: `${minutes}m ${seconds}s`,
        profit: sessionProfit,
        trades: tradesThisSession,
        symbol: selectedSymbol
      };
      
      setAutoTradeHistory(prev => [summary, ...prev]);
      
      const nextSession = currentSessionCount + 1;
      setCurrentSessionCount(nextSession);
      
      if (nextSession >= 3) {
        setIsAutoTrading(false);
        setCurrentSessionCount(0);
        addLog('Auto-Trading completed 3 sessions. All tasks finished.', 'success');
      } else {
        addLog(`Auto-Trading: Session ${nextSession}/3 finished. Waiting for cooldown...`, 'info');
      }
    }
  };

  const disconnectDeriv = () => {
    derivRef.current?.disconnect();
    derivRef.current = null;
    setIsAuthorized(false);
    setIsBotRunning(false);
    
    if (!saveToken) {
      setApiToken('');
      localStorage.removeItem('deriv_api_token');
    }
    
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
    const currentSymbol = selectedSymbolRef.current;
    const currentBotType = botTypeRef.current;
    
    const symbolInfo = symbolsRef.current.find(s => s.symbol === currentSymbol);
    // Default pip_size for Volatility indices is usually 2, except for some like 10 (3) or 100 (2)
    // For R_100 it is 2.
    let pipSize = symbolInfo?.pip_size;
    if (pipSize === undefined) {
      if (currentSymbol.includes('100')) pipSize = 2;
      else if (currentSymbol.includes('10')) pipSize = 3;
      else pipSize = 2;
    }
    
    const lastDigit = parseInt(tick.quote.toFixed(pipSize).slice(-1));

    const newDigits = [...lastDigitsRef.current, lastDigit].slice(-10);
    setLastDigits(newDigits);
    lastDigitsRef.current = newDigits;

    if (!isBotRunningRef.current || isTradingRef.current) return;

    if (currentBotType === 'EVEN_ODD') {
      // Strategy: 4 consecutive same type -> counter trade
      const last4 = newDigits.slice(-4);
      if (last4.length < 4) return;

      const allOdd = last4.every(d => d % 2 !== 0);
      const allEven = last4.every(d => d % 2 === 0);

      if (allOdd) {
        addLog('Strategy: 4 Odds detected. Counter-trading EVEN.', 'info');
        executeTrade('DIGITEVEN');
      } else if (allEven) {
        addLog('Strategy: 4 Evens detected. Counter-trading ODD.', 'info');
        executeTrade('DIGITODD');
      }
    } else {
      // Strategy: Over/Under (specifically Under 5 on Volatility 100 when digit is 0 or 1)
      if (currentSymbol.includes('100') && (lastDigit === 0 || lastDigit === 1)) {
        addLog(`Strategy: Digit ${lastDigit} detected. Trading UNDER 5.`, 'info');
        executeTrade('DIGITUNDER', 5);
      }
    }
  };

  const executeTrade = async (type: 'DIGITEVEN' | 'DIGITODD' | 'DIGITUNDER', barrier?: number) => {
    if (isTradingRef.current || !derivRef.current) return;
    isTradingRef.current = true;

    const currentStake = statsRef.current.currentStake;
    
    // Double check TP/SL before starting a new trade
    if (statsRef.current.totalProfit >= takeProfitRef.current) {
      stopBot('Take Profit already reached');
      isTradingRef.current = false;
      return;
    }
    if (statsRef.current.totalProfit <= -stopLossRef.current) {
      stopBot('Stop Loss already reached');
      isTradingRef.current = false;
      return;
    }

    // Safety check for $5 capital
    if (currentStake > statsRef.current.balance) {
      addLog(`Insufficient balance for next stake ($${currentStake.toFixed(2)})`, 'error');
      stopBot();
      isTradingRef.current = false;
      return;
    }

    addLog(`Trade #${statsRef.current.totalTrades + 1}: ${type}${barrier !== undefined ? ` LDP ${barrier}` : ''} | Stake: $${currentStake.toFixed(2)}`, 'trade');

    try {
      const result = await derivRef.current.placeTrade(selectedSymbolRef.current, currentStake, type, barrier);
      const newTotalProfit = statsRef.current.totalProfit + result.profit;
      const newBalance = statsRef.current.balance + result.profit;
      
      if (result.isWin) {
        addLog(`Win! +$${result.profit.toFixed(2)}`, 'success');
        setCurrentStep(0);
        currentStepRef.current = 0;
        setStats(prev => ({
          ...prev,
          wins: prev.wins + 1,
          totalTrades: prev.totalTrades + 1,
          totalProfit: newTotalProfit,
          balance: newBalance,
          currentStake: stakeRef.current,
        }));
        // Update ref immediately for next check
        statsRef.current = {
          ...statsRef.current,
          wins: statsRef.current.wins + 1,
          totalTrades: statsRef.current.totalTrades + 1,
          totalProfit: newTotalProfit,
          balance: newBalance,
          currentStake: stakeRef.current,
        };
        setTradesThisSession(prev => prev + 1);
      } else {
        addLog(`Loss. -$${Math.abs(result.profit).toFixed(2)}`, 'error');
        const nextStep = currentStepRef.current + 1;
        
        if (nextStep >= maxMartingaleStepsRef.current) {
          addLog('Max Martingale steps reached. Resetting to base stake.', 'info');
          setCurrentStep(0);
          currentStepRef.current = 0;
          setStats(prev => ({
            ...prev,
            losses: prev.losses + 1,
            totalTrades: prev.totalTrades + 1,
            totalProfit: newTotalProfit,
            balance: newBalance,
            currentStake: stakeRef.current,
          }));
          statsRef.current = {
            ...statsRef.current,
            losses: statsRef.current.losses + 1,
            totalTrades: statsRef.current.totalTrades + 1,
            totalProfit: newTotalProfit,
            balance: newBalance,
            currentStake: stakeRef.current,
          };
          setTradesThisSession(prev => prev + 1);
        } else {
          setCurrentStep(nextStep);
          currentStepRef.current = nextStep;
          const nextStake = Math.round(currentStake * martingaleMultiplierRef.current * 100) / 100;
          setStats(prev => ({
            ...prev,
            losses: prev.losses + 1,
            totalTrades: prev.totalTrades + 1,
            totalProfit: newTotalProfit,
            balance: newBalance,
            currentStake: nextStake,
          }));
          statsRef.current = {
            ...statsRef.current,
            losses: statsRef.current.losses + 1,
            totalTrades: statsRef.current.totalTrades + 1,
            totalProfit: newTotalProfit,
            balance: newBalance,
            currentStake: nextStake,
          };
          setTradesThisSession(prev => prev + 1);
        }
      }

      // Over-trading Check
      if (tradesThisSession + 1 >= maxTradesPerSession) {
        const endTime = Date.now() + cooldownMinutes * 60000;
        setCooldownEndTime(endTime);
        stopBot('Session Limit Reached');
        addLog(`OVER-TRADING DETECTED! Session limit of ${maxTradesPerSession} trades reached. Bot stopped for ${cooldownMinutes} minutes.`, 'error');
      }

      // TP/SL Logic
      if (newTotalProfit >= takeProfitRef.current) {
        addLog(`Target Profit Reached: +$${newTotalProfit.toFixed(2)}`, 'success');
        stopBot('Take Profit Reached');
      } else if (newTotalProfit <= -stopLossRef.current) {
        addLog(`Stop Loss Reached: -$${Math.abs(newTotalProfit).toFixed(2)}`, 'error');
        stopBot('Stop Loss Reached');
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
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2 hover:bg-[#30363d] rounded-lg transition-colors text-[#8b949e] hover:text-white"
              title="Auto-Trade History"
            >
              <List className="w-5 h-5" />
            </button>
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
                  <div className="flex items-center gap-2 px-1">
                    <input 
                      type="checkbox" 
                      id="saveToken"
                      checked={saveToken}
                      onChange={(e) => setSaveToken(e.target.checked)}
                      className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#1f6feb] focus:ring-[#1f6feb]/50"
                    />
                    <label htmlFor="saveToken" className="text-xs text-[#8b949e] cursor-pointer select-none">
                      Save connection for next time
                    </label>
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
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-[#3fb950]/10 border border-[#3fb950]/20 rounded-xl">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#3fb950]" />
                      <div className="text-sm">
                        <p className="font-semibold text-[#3fb950]">Authenticated</p>
                        <p className="text-xs text-[#8b949e]">Ready to trade</p>
                      </div>
                    </div>
                    <button 
                      onClick={disconnectDeriv}
                      disabled={isBotRunning}
                      className="text-xs text-[#f85149] hover:text-[#da3633] disabled:opacity-50 font-bold uppercase tracking-wider transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-1">
                    <input 
                      type="checkbox" 
                      id="saveTokenAuth"
                      checked={saveToken}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSaveToken(checked);
                        if (checked) {
                          localStorage.setItem('deriv_api_token', apiToken);
                        } else {
                          localStorage.removeItem('deriv_api_token');
                        }
                      }}
                      className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#1f6feb] focus:ring-[#1f6feb]/50"
                    />
                    <label htmlFor="saveTokenAuth" className="text-xs text-[#8b949e] cursor-pointer select-none">
                      Save connection for next time
                    </label>
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
                <label className="text-xs text-[#8b949e] ml-1">Select Bot Strategy</label>
                <select 
                  value={botType}
                  onChange={(e) => setBotType(e.target.value as any)}
                  disabled={isBotRunning}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50 font-bold text-[#1f6feb]"
                >
                  <option value="EVEN_ODD">Bot 1: Even/Odd Strategy</option>
                  <option value="OVER_UNDER">Bot 2: Over/Under Strategy (R_100)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#8b949e] ml-1">Trading Instrument</label>
                <select 
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  disabled={isBotRunning || botType === 'OVER_UNDER'}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f6feb]/50 disabled:opacity-50"
                >
                  {botType === 'OVER_UNDER' ? (
                    symbols.filter(s => s.symbol.includes('100')).length > 0 ? (
                      symbols.filter(s => s.symbol.includes('100')).map(s => (
                        <option key={s.symbol} value={s.symbol}>{s.display_name}</option>
                      ))
                    ) : (
                      <option value="R_100">Volatility 100 Index</option>
                    )
                  ) : (
                    symbols.length > 0 ? (
                      symbols.map(s => (
                        <option key={s.symbol} value={s.symbol}>{s.display_name}</option>
                      ))
                    ) : (
                      <option value="R_100">Volatility 100 Index</option>
                    )
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

          {/* Auto Trading Card */}
          <section className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-[#30363d] flex items-center justify-between bg-[#1c2128]">
              <div className="flex items-center gap-2">
                <RefreshCw className={`w-4 h-4 ${isAutoTrading ? 'text-[#3fb950] animate-spin-slow' : 'text-[#8b949e]'}`} />
                <h2 className="font-semibold text-sm uppercase tracking-wide">Auto Trading</h2>
              </div>
              <button 
                onClick={() => setIsAutoTrading(!isAutoTrading)}
                disabled={isBotRunning}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${isAutoTrading ? 'bg-[#3fb950]' : 'bg-[#30363d]'}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isAutoTrading ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#8b949e]">Status</span>
                <span className={isAutoTrading ? 'text-[#3fb950] font-bold' : 'text-[#8b949e]'}>
                  {isAutoTrading ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#8b949e]">Session Progress</span>
                <span className="text-white font-mono">{currentSessionCount}/3</span>
              </div>
              <div className="w-full bg-[#0d1117] h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-[#3fb950] h-full transition-all duration-500" 
                  style={{ width: `${(currentSessionCount / 3) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-[#8b949e] italic leading-relaxed mt-2">
                * {botType === 'EVEN_ODD' ? 'Cycles through Vol 25(1s), 30(1s), and 100(1s)' : 'Trades Volatility 100 Index only'} across 3 sessions with cooldowns.
              </p>
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
                    {botType === 'EVEN_ODD' ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-[#f85149]" />
                          <span>4 Odds &rarr; Bet Even</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-[#3fb950]" />
                          <span>4 Evens &rarr; Bet Odd</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-[#1f6feb]" />
                          <span>Digit 0 or 1 &rarr; Bet Under 5</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[#8b949e] text-[10px]">
                          <span>(Volatility 100 Index Only)</span>
                        </div>
                      </>
                    )}
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

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
            onClick={() => setShowHistory(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#161b22] border border-[#30363d] rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-[#30363d] flex items-center justify-between bg-[#1c2128]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#1f6feb]/10 rounded-xl flex items-center justify-center">
                    <History className="w-6 h-6 text-[#1f6feb]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">Auto-Trade History</h2>
                    <p className="text-xs text-[#8b949e]">Performance across all sessions</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-2 hover:bg-[#30363d] rounded-full transition-colors"
                >
                  <LogOut className="w-5 h-5 rotate-180" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {autoTradeHistory.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-[#484f58] gap-4">
                    <Clock className="w-12 h-12 opacity-20" />
                    <p className="italic">No auto-trade history yet</p>
                  </div>
                ) : (
                  autoTradeHistory.map((session) => (
                    <div key={session.id} className="bg-[#0d1117] border border-[#30363d] rounded-2xl p-5 flex items-center justify-between group hover:border-[#1f6feb]/50 transition-all">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#1f6feb] uppercase tracking-widest">{session.symbol}</span>
                          <span className="text-[10px] text-[#484f58]">•</span>
                          <span className="text-xs text-[#8b949e]">{session.startTime} - {session.endTime}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <Activity className="w-3 h-3 text-[#8b949e]" />
                            <span className="font-mono">{session.trades} trades</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#8b949e]" />
                            <span className="font-mono">{session.duration}</span>
                          </div>
                        </div>
                      </div>
                      <div className={`text-xl font-mono font-bold ${session.profit >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                        {session.profit >= 0 ? '+' : ''}${session.profit.toFixed(2)}
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              {autoTradeHistory.length > 0 && (
                <div className="p-6 border-t border-[#30363d] bg-[#1c2128]">
                  <button 
                    onClick={() => {
                      if (confirm('Clear all auto-trade history?')) {
                        setAutoTradeHistory([]);
                      }
                    }}
                    className="w-full py-3 text-xs font-bold text-[#f85149] hover:bg-[#f85149]/10 rounded-xl transition-all uppercase tracking-widest"
                  >
                    Clear History
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
