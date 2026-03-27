/**
 * Deriv API Service
 * Handles WebSocket connection and trading logic for Deriv.com
 */

export type Tick = {
  symbol: string;
  quote: number;
  epoch: number;
  last_digit: number;
};

export type TradeResult = {
  profit: number;
  isWin: boolean;
  contractId: number;
};

export class DerivService {
  private ws: WebSocket | null = null;
  private appId: string;
  private token: string = '';
  private onTickCallback: ((tick: any) => void) | null = null;
  private isAuthorized: boolean = false;
  private messageListeners: Set<(msg: any) => void> = new Set();

  constructor(appId: string = '1089') {
    this.appId = appId;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('Connected to Deriv API');
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.msg_type === 'tick') {
          const tick = data.tick;
          // We'll handle last digit calculation in the App component with pip_size awareness
          if (this.onTickCallback) {
            this.onTickCallback(tick);
          }
        }

        // Notify all registered listeners
        this.messageListeners.forEach(listener => listener(data));

        if (data.msg_type === 'authorize' && !data.error) {
          this.isAuthorized = true;
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket Closed');
        this.isAuthorized = false;
      };
    });
  }

  authorize(token: string): Promise<any> {
    this.token = token;
    return this.send({ authorize: token });
  }

  subscribeTicks(symbol: string, callback: (tick: any) => void) {
    this.onTickCallback = callback;
    this.send({ ticks: symbol });
  }

  unsubscribeTicks(symbol: string) {
    this.send({ forget_all: 'ticks' });
    this.onTickCallback = null;
  }

  getActiveSymbols(): Promise<any> {
    return this.send({ active_symbols: 'full', product_type: 'basic' });
  }

  async placeTrade(symbol: string, amount: number, type: 'DIGITEVEN' | 'DIGITODD' | 'DIGITUNDER', barrier?: number): Promise<TradeResult> {
    if (!this.isAuthorized) throw new Error('Not authorized');

    console.log(`[Trade] Requesting proposal: ${type} | ${symbol} | $${amount}${barrier !== undefined ? ` | Barrier: ${barrier}` : ''}`);

    // 1. Get proposal
    const proposalParams: any = {
      proposal: 1,
      amount: amount,
      basis: 'stake',
      contract_type: type,
      currency: 'USD',
      duration: 1,
      duration_unit: 't',
      symbol: symbol,
    };

    if (barrier !== undefined) {
      proposalParams.barrier = barrier.toString();
    }

    const proposal = await this.send(proposalParams);

    if (proposal.error) {
      console.error('[Trade] Proposal Error:', proposal.error);
      throw new Error(proposal.error.message);
    }

    const proposalId = proposal.proposal.id;
    console.log('[Trade] Proposal received:', proposalId);

    // 2. Buy contract
    const buy = await this.send({
      buy: proposalId,
      price: amount,
    });

    if (buy.error) {
      console.error('[Trade] Buy Error:', buy.error);
      throw new Error(buy.error.message);
    }

    const contractId = buy.buy.contract_id;
    console.log('[Trade] Contract purchased:', contractId);

    // 3. Wait for result
    return new Promise((resolve, reject) => {
      // 30s timeout is generous for a 1-tick trade
      const timeout = setTimeout(() => {
        this.messageListeners.delete(checkResult);
        console.error(`[Trade] Timeout waiting for contract ${contractId}`);
        reject(new Error('Trade result timeout (30s)'));
      }, 30000);

      const checkResult = (msg: any) => {
        // Log all POC messages for debugging
        if (msg.msg_type === 'proposal_open_contract') {
          const poc = msg.proposal_open_contract;
          
          // Use loose equality for contract_id to handle potential string/number mismatch
          if (poc.contract_id == contractId) {
            console.log(`[Trade] Contract Update [${contractId}]: Status=${poc.status}, IsCompleted=${poc.is_completed}`);
            
            // Some contracts might be completed but status is not 'won'/'lost' yet in some message versions
            // but usually is_completed is the reliable flag
            if (poc.is_completed || poc.status !== 'open') {
              clearTimeout(timeout);
              this.messageListeners.delete(checkResult);
              
              // Unsubscribe from this contract to keep stream clean
              this.send({ forget: poc.id }).catch(() => {});

              resolve({
                profit: poc.profit || 0,
                isWin: poc.status === 'won',
                contractId: contractId,
              });
            }
          }
        }
      };

      this.messageListeners.add(checkResult);
      
      // Subscribe to updates for this contract
      // We use the contractId from the buy response
      this.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
        .then(response => {
          if (response.error) {
            console.error('[Trade] POC Subscription Error:', response.error);
          } else {
            console.log('[Trade] Subscribed to POC for', contractId);
          }
        })
        .catch(err => console.error('[Trade] POC Subscription Failed:', err));
    });
  }

  private send(data: any): Promise<any> {
    return new Promise((resolve) => {
      const requestId = Math.floor(Math.random() * 1000000);
      const payload = { ...data, req_id: requestId };
      
      const listener = (event: MessageEvent) => {
        const response = JSON.parse(event.data);
        if (response.req_id === requestId) {
          this.ws?.removeEventListener('message', listener);
          resolve(response);
        }
      };

      this.ws?.addEventListener('message', listener);
      this.ws?.send(JSON.stringify(payload));
    });
  }

  disconnect() {
    this.ws?.close();
  }
}
