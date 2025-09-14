import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { config } from '../config/environment';
import { Utils, ErrorHandler } from '../utils';

/**
 * Handles HTTP communication with the Soundness game API
 */
export class GameAPIClient {
  private axiosInstance: AxiosInstance;
  private readonly MAX_ATTEMPTS = 2160; // 3 hours at 5s intervals

  constructor() {
    this.axiosInstance = this.createAxiosInstance();
  }

  /**
   * Creates configured axios instance
   */
  private createAxiosInstance(): AxiosInstance {
    return axios.create({
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
   */
  public async submitGameCompletion(
    gameId: string, 
    solution: string, 
    stats: any
  ): Promise<string> {
    ErrorHandler.log(`Submitting game completion for ${gameId}...`, 'GameAPI');
    
    const payload = new URLSearchParams({
      game_id: gameId,
      solution: solution,
      stats: JSON.stringify(stats)
    });

    return await this.pollForResult({
      requestFactory: () => this.axiosInstance.post('/api/game_completed', payload, {
        headers: { 'referer': `https://fun.soundness.xyz/game/${gameId}` }
      }),
      resultExtractor: (response) => this.extractVictoryUrl(response),
      progressMessage: 'Still generating victory URL...',
      successMessage: 'Victory URL ready',
      errorContext: 'Victory URL generation'
    });
  }

  /**
   * Polls for CLI command until ready
   */
  public async pollForCLICommand(victoryUrl: string): Promise<string> {
    ErrorHandler.log('Waiting for proof generation...', 'GameAPI');
    
    const url = new URL(victoryUrl);
    const relativePath = url.pathname;
    
    return await this.pollForResult({
      requestFactory: () => this.axiosInstance.get(relativePath),
      resultExtractor: (response) => this.extractCLICommand(response),
      progressMessage: 'Still generating CLI command...',
      successMessage: 'CLI command ready',
      errorContext: 'CLI command generation'
    });
  }

  /**
   * Generic polling method for API results
   */
  private async pollForResult<T>({
    requestFactory,
    resultExtractor,
    progressMessage,
    successMessage,
    errorContext
  }: {
    requestFactory: () => Promise<AxiosResponse>;
    resultExtractor: (response: AxiosResponse) => T | null;
    progressMessage: string;
    successMessage: string;
    errorContext: string;
  }): Promise<T> {
    let attemptCount = 0;
    const startTime = Date.now();

    while (attemptCount < this.MAX_ATTEMPTS) {
      attemptCount++;
      const elapsedMinutes = this.getElapsedMinutes(startTime);
      
      try {
        const response = await requestFactory();

        // Handle immediate redirects (victory URL ready)
        if (response.status === 302 && response.headers.location) {
          const victoryUrl = new URL(response.headers.location, config.API_BASE_URL).href;
          ErrorHandler.log(`${successMessage} after ${elapsedMinutes}m: ${victoryUrl}`, 'GameAPI');
          return victoryUrl as T;
        }

        // Handle error status codes
        if (response.status === 404) {
          throw new Error(`Resource not found (404)`);
        }

        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Handle 200 OK response
        if (response.status === 200) {
          const html = response.data;
          
          // Check for failure states
          this.checkForFailureStates(html);
          
          // Try to extract result
          const result = resultExtractor(response);
          if (result) {
            ErrorHandler.log(`${successMessage} after ${elapsedMinutes}m (attempt ${attemptCount})`, 'GameAPI');
            return result;
          }
          
          // Log progress periodically
          if (attemptCount % 60 === 0) {
            ErrorHandler.log(`${progressMessage} ${elapsedMinutes}m elapsed (attempt ${attemptCount}/${this.MAX_ATTEMPTS})`, 'GameAPI');
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Stop immediately for known error conditions
        if (this.shouldStopPolling(errorMessage)) {
          throw new Error(`${errorContext} failed: ${errorMessage}`);
        }
        
        // Continue silently for network errors
        if (attemptCount % 120 === 0) { // Log every 10 minutes for network errors
          ErrorHandler.warn(`Network error (continuing): ${errorMessage}`, 'GameAPI');
        }
      }

      await Utils.delay(5000);
    }

    const totalMinutes = this.getElapsedMinutes(startTime);
    throw new Error(`${errorContext} timeout after ${totalMinutes} minutes (${this.MAX_ATTEMPTS} attempts)`);
  }

  /**
   * Extracts victory URL from response
   */
  private extractVictoryUrl(response: AxiosResponse): string | null {
    if (response.status === 302 && response.headers.location) {
      return new URL(response.headers.location, config.API_BASE_URL).href;
    }
    return null;
  }

  /**
   * Extracts CLI command from HTML response
   */
  private extractCLICommand(response: AxiosResponse): string | null {
    const html = response.data;
    if (!html || typeof html !== 'string') return null;

    const codeBlockRegex = /<code[^>]*>(.*?)<\/code>/s;
    const matches = html.match(codeBlockRegex);

    if (!matches) return null;

    let rawCommand = matches[1];
    if (!rawCommand.includes('soundness-cli send')) return null;

    return this.cleanHTMLCommand(rawCommand);
  }

  /**
   * Cleans HTML entities from command string
   */
  private cleanHTMLCommand(rawCommand: string): string {
    return rawCommand
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/<\/[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Checks for failure states in HTML response
   */
  private checkForFailureStates(html: string): void {
    const failureStates = [
      'Proof generation failed - no blob ID available',
      'Game completion failed',
      'Invalid game state'
    ];

    for (const failureState of failureStates) {
      if (html.includes(failureState)) {
        throw new Error(failureState);
      }
    }
  }

  /**
   * Determines if polling should stop based on error message
   */
  private shouldStopPolling(errorMessage: string): boolean {
    const stopConditions = [
      'not found',
      'failed',
      'HTTP 4',
      'HTTP 5',
      'Proof generation failed',
      'Invalid game state'
    ];

    return stopConditions.some(condition => errorMessage.includes(condition));
  }

  /**
   * Calculates elapsed minutes from start time
   */
  private getElapsedMinutes(startTime: number): number {
    return Math.floor((Date.now() - startTime) / 60000);
  }
}