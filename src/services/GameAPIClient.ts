import axios, { AxiosInstance } from 'axios';
import { config } from '../config/environment';

/**
 * Handles HTTP communication with the Soundness game API with clean separated polling
 */
export class GameAPIClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: config.API_BASE_URL,
      timeout: 30000,
      headers: {
        'host': 'fun.soundness.xyz',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-site': 'same-origin',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        'sec-fetch-mode': 'navigate',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://fun.soundness.xyz',
        'connection': 'keep-alive',
        'sec-fetch-dest': 'document'
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 500
    });
  }

  /**
   * Submits game completion and polls until victory URL is ready
   * @param gameId - Unique game identifier
   * @param solution - Solution string for the puzzle
   * @param stats - Game statistics object
   * @returns Victory page URL
   */
  public async submitGameCompletion(gameId: string, solution: string, stats: any): Promise<string> {
    console.log(`   📤 Submitting game completion for ${gameId}...`);
    
    const payload = new URLSearchParams({
      game_id: gameId,
      solution: solution,
      stats: JSON.stringify(stats)
    });

    return await this.pollUntilComplete({
      makeRequest: () => this.axiosInstance.post('/api/game_completed', payload, {
        headers: { 'referer': `https://fun.soundness.xyz/game/${gameId}` }
      }),
      processResponse: (html) => this.processVictoryResponse(html),
      type: 'victory',
      errorName: 'Victory URL'
    });
  }

  /**
   * Polls for CLI command until ready
   * @param victoryUrl - Victory page URL to poll
   * @returns CLI command string
   */
  public async pollForCLICommand(victoryUrl: string): Promise<string> {
    console.log(`   📄 Waiting for proof generation...`);
    
    // Extract relative path from victory URL
    const url = new URL(victoryUrl);
    const relativePath = url.pathname;
    
    return await this.pollUntilComplete({
      makeRequest: () => this.axiosInstance.get(relativePath),
      processResponse: (html) => this.processCLIResponse(html),
      type: 'cli',
      errorName: 'CLI command'
    });
  }

  /**
   * Unified polling method
   */
  private async pollUntilComplete<T>({ makeRequest, processResponse, type, errorName }: {
    makeRequest: () => Promise<any>;
    processResponse: (html: string) => { result?: T; shouldContinue: boolean; logMessage?: string };
    type: 'victory' | 'cli';
    errorName: string;
  }): Promise<T> {
    let attemptCount = 0;
    const maxAttempts = 2160; // 3 hours
    const startTime = Date.now();

    while (attemptCount < maxAttempts) {
      attemptCount++;
      const elapsedMinutes = this.getElapsedMinutes(startTime);
      
      try {
        const response = await makeRequest();

        // Handle status codes
        const statusResult = this.handleStatusCode(response, type);
        if (statusResult.shouldStop) {
          if (statusResult.error) throw new Error(statusResult.error);
          if (statusResult.result) return statusResult.result as T;
        }

        // Handle 200 OK response
        if (response.status === 200) {
          const html = response.data;
          
          // Check failure states (only for CLI)
          if (type === 'cli') {
            this.checkFailureStates(html);
          }
          
          // Process response based on type
          const processResult = processResponse(html);
          if (processResult.result) {
            console.log(`   ✅ ${errorName} ready after ${elapsedMinutes}m (attempt ${attemptCount})`);
            return processResult.result;
          }
          
          // Log progress if needed
          if (processResult.logMessage && attemptCount % 60 === 0) {
            console.log(`   ⏳ ${processResult.logMessage} ${elapsedMinutes}m elapsed (attempt ${attemptCount}/${maxAttempts})`);
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.handlePollingError(errorMessage);
      }

      await this.delay(5000);
    }

    const totalMinutes = this.getElapsedMinutes(startTime);
    throw new Error(`${errorName} timeout after ${totalMinutes} minutes (${maxAttempts} attempts)`);
  }

  /**
   * Processes victory URL response
   */
  private processVictoryResponse(html: string): { result?: string; shouldContinue: boolean; logMessage?: string } {
    if (this.isWaitingState(html)) {
      return { shouldContinue: true, logMessage: 'Still generating victory URL...' };
    }
    
    return { shouldContinue: true, logMessage: 'Unexpected response state, continuing...' };
  }

  /**
   * Processes CLI command response
   */
  private processCLIResponse(html: string): { result?: string; shouldContinue: boolean; logMessage?: string } {
    const cliCommand = this.extractCLICommand(html);
    if (cliCommand) {
      return { result: cliCommand, shouldContinue: false };
    }
    
    if (this.isWaitingState(html)) {
      return { shouldContinue: true, logMessage: 'Still generating CLI...' };
    }
    
    return { shouldContinue: true, logMessage: 'CLI command not ready yet...' };
  }

  /**
   * Calculates elapsed minutes
   */
  private getElapsedMinutes(startTime: number): number {
    return Math.floor((Date.now() - startTime) / 60000);
  }

  /**
   * Handles HTTP status codes
   */
  private handleStatusCode(response: any, type: 'victory' | 'cli'): {
    shouldStop: boolean;
    error?: string;
    result?: string;
  } {
    if (response.status === 404) {
      const errorMsg = type === 'victory' ? 'Game not found' : 'Victory page not found';
      return { shouldStop: true, error: errorMsg };
    }

    if (response.status >= 400) {
      return { shouldStop: true, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Handle 302 redirect (victory URL ready)
    if (response.status === 302 && response.headers.location) {
      const victoryUrl = new URL(response.headers.location, config.API_BASE_URL).href;
      const elapsedMinutes = this.getElapsedMinutes(Date.now() - 60000); // Rough estimate
      console.log(`   ✅ Victory URL ready after ${elapsedMinutes}m: ${victoryUrl}`);
      return { shouldStop: true, result: victoryUrl };
    }

    return { shouldStop: false };
  }

  /**
   * Checks for failure states in HTML
   */
  private checkFailureStates(html: string): void {
    if (html.includes('Proof generation failed - no blob ID available')) {
      throw new Error('Proof generation failed - no blob ID available');
    }
  }

  /**
   * Checks for waiting states in HTML
   */
  private isWaitingState(html: string): boolean {
    return html.includes('Generating zero-knowledge proof') || 
           html.includes('Your victory page is being created. Please wait') ||
           html.includes('🔄 Generating proof and uploading to Walrus');
  }

  /**
   * Handles polling errors
   */
  private handlePollingError(errorMessage: string): void {
    // Stop immediately for known error conditions
    if (errorMessage.includes('not found') || 
        errorMessage.includes('failed') || 
        errorMessage.includes('HTTP')) {
      throw new Error(errorMessage);
    }
    // Continue silently for network errors
  }

  /**
   * Extracts CLI command from HTML response
   */
  private extractCLICommand(html: string): string | null {
    if (!html || typeof html !== 'string') return null;

    const codeBlockRegex = /<code[^>]*>(.*?)<\/code>/s;
    const matches = html.match(codeBlockRegex);

    if (!matches) return null;

    let rawCommand = matches[1];
    if (!rawCommand.includes('soundness-cli send')) return null;

    return rawCommand
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/<\/[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}