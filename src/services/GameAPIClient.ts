import axios, { AxiosInstance } from 'axios';
import { CLIData } from '../types';
import { config } from '../config/environment';

/**
 * Handles HTTP communication with the Soundness game API
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
      validateStatus: (status) => status >= 200 && status < 400
    });
  }

  /**
   * Submits game completion data to the API
   * @param gameId - Unique game identifier
   * @param solution - Solution string for the puzzle
   * @param stats - Game statistics object
   * @returns Victory page URL for CLI command retrieval
   */
  public async submitGameCompletion(gameId: string, solution: string, stats: any): Promise<string> {
    try {
      const payload = new URLSearchParams({
        game_id: gameId,
        solution: solution,
        stats: JSON.stringify(stats)
      });

      const response = await this.axiosInstance.post('/api/game_completed', payload);
      const redirectUrl = this.extractRedirectUrl(response);

      if (!redirectUrl) {
        throw new Error('Could not determine victory URL from response');
      }

      console.log(`   🔗 Victory URL: ${redirectUrl}`);
      return redirectUrl;
    } catch (error) {
      throw new Error(`Game submission failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Polls victory URL until CLI command is generated
   * @param victoryUrl - URL to poll for CLI command
   * @returns CLI command data when ready
   */
  public async pollForCLICommand(victoryUrl: string): Promise<CLIData> {
    let attemptCount = 0;
    const maxAttempts = 2160;
    const startTime = Date.now();

    while (attemptCount < maxAttempts) {
      attemptCount++;
      const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
      
      try {
        const response = await this.axiosInstance.get(victoryUrl);
        const cliData = this.extractCLICommand(response.data);

        if (cliData) {
          console.log(`   ✅ CLI command ready after ${elapsedMinutes} minutes (attempt ${attemptCount})`);
          return cliData;
        }

        if (attemptCount % 60 === 0) {
          console.log(`   ⏳ Still waiting for proof generation... ${elapsedMinutes} minutes elapsed (attempt ${attemptCount}/${maxAttempts})`);
        }

      } catch (error) {
        if (attemptCount % 120 === 0) {
          console.log(`   ⚠️ Network error at attempt ${attemptCount}, continuing to poll...`);
        }
      }

      await this.delay(5000);
    }

    const totalMinutes = Math.floor((Date.now() - startTime) / 60000);
    throw new Error(`Timeout waiting for CLI command generation after ${totalMinutes} minutes (${maxAttempts} attempts)`);
  }

  /**
   * Extracts redirect URL from API response
   */
  private extractRedirectUrl(response: any): string | null {
    if (response.headers.location) {
      return new URL(response.headers.location, config.API_BASE_URL).href;
    }

    if (response.request?.res?.responseUrl) {
      return response.request.res.responseUrl;
    }

    if (response.data && typeof response.data === 'string') {
      const urlMatch = response.data.match(/href="([^"]*\/r\/victory\/[^"]*)"/);
      if (urlMatch) {
        return new URL(urlMatch[1], config.API_BASE_URL).href;
      }
    }

    return null;
  }

  /**
   * Extracts CLI command from HTML response
   */
  private extractCLICommand(html: string): CLIData | null {
    if (html.includes('Generating proof') || html.includes('🔄')) {
      return null;
    }

    const codeBlockRegex = /<code[^>]*>(.*?)<\/code>/s;
    const matches = html.match(codeBlockRegex);

    if (!matches) return null;

    let rawCommand = matches[1];
    if (!rawCommand.includes('soundness-cli send')) return null;

    const fullCommand = rawCommand
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/<\/[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const blobMatch = html.match(/Walrus Blob ID:<\/strong>\s*<code>([^<]+)<\/code>/);
    const blobId = blobMatch ? blobMatch[1] : undefined;

    return {
      cliCommand: fullCommand,
      blobId,
      fullCommand
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}