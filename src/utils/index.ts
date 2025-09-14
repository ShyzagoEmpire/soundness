import { MessageAnalysis } from '../types';

/**
 * Unified error handling utilities
 */
export class ErrorHandler {
  static handle(error: unknown, context: string): never {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ ${context} failed: ${message}`);
    
    // Add context-specific hints
    if (message.includes('Incorrect login details') || message.includes('401')) {
      console.log('💡 Hint: Check if your Discord token is valid and not expired');
    } else if (message.includes('timeout')) {
      console.log('💡 Hint: Network issue or Discord API is slow');
    } else if (message.includes('Missing Access')) {
      console.log('💡 Hint: Token may not have necessary permissions');
    }
    
    throw new Error(`${context}: ${message}`);
  }

  static log(message: string, context?: string): void {
    const prefix = context ? `[${context}]` : '';
    console.log(`${prefix} ${message}`);
  }

  static warn(message: string, context?: string): void {
    const prefix = context ? `[${context}]` : '';
    console.log(`⚠️ ${prefix} ${message}`);
  }
}

/**
 * Discord message analysis utilities
 */
export class MessageAnalyzer {
  static analyze(message: any, userRoles?: Array<{ id: string; name: string }>): MessageAnalysis {
    const isRateLimited = this.checkRateLimit(message);
    const isAccessRestricted = this.checkAccessRestriction(message);
    const hasValidResponse = this.hasValidResponse(message);
    
    let errorType: MessageAnalysis['errorType'] = undefined;
    if (isRateLimited) errorType = 'RATE_LIMIT';
    else if (isAccessRestricted) errorType = 'BOT_RESTRICTION';
    else if (!hasValidResponse) errorType = 'INVALID_RESPONSE';
    
    const result: MessageAnalysis = {
      isRateLimited,
      isAccessRestricted,
      hasValidResponse,
      errorType
    };

    // Extract role information for access restriction cases
    if (isAccessRestricted && userRoles) {
      result.requiredRole = this.extractRequiredRole(message);
      result.userRole = this.getUserSpecialRole(userRoles);
    }

    return result;
  }

  private static checkRateLimit(message: any): boolean {
    return message.content?.includes('too many games recently') || 
           message.content?.includes('wait 24 hours');
  }

  private static checkAccessRestriction(message: any): boolean {
    return message.embeds?.[0]?.title?.includes('Access Restricted') || false;
  }

  private static hasValidResponse(message: any): boolean {
    return !!(message.embeds?.length > 0 || message.content);
  }

  private static extractRequiredRole(message: any): string {
    if (message.embeds?.[0]?.fields) {
      const requiredRoleField = message.embeds[0].fields.find((field: any) => 
        field.name?.includes('Required Role')
      );
      if (requiredRoleField?.value) {
        const roleMatch = requiredRoleField.value.match(/\*\*([^*]+)\*\*/);
        return roleMatch ? roleMatch[1] : 'unknown role';
      }
    }
    return 'unknown role';
  }

  private static getUserSpecialRole(userRoles: Array<{ id: string; name: string }>): string {
    // This would need to be injected or configured, but for simplicity using a basic approach
    const specialRole = userRoles.find(role => 
      ['Echo', 'Sigma', 'Theta', 'Delta', 'Omega'].includes(role.name)
    );
    return specialRole ? specialRole.name : 'unknown role';
  }
}

/**
 * Common utility functions
 */
export class Utils {
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    );
    return Promise.race([promise, timeout]);
  }

  static generateNonce(): string {
    const timestamp = Date.now() - 1420070400000;
    const random = Math.floor(Math.random() * 4096);
    return ((timestamp << 22) | (1 << 17) | random).toString();
  }

  static extractNumberFromField(fields: any[], regex: RegExp): number | null {
    const field = fields.find((f: any) => regex.test(f.name));
    if (!field) return null;
    const match = field.value.match(/\*\*(\d+(?:\.\d+)?)\*\*/);
    return match ? parseFloat(match[1]) : null;
  }

  static parseCommand(commandString: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < commandString.length; i++) {
      const char = commandString[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }
}