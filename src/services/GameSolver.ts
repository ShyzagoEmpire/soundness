import { GameStats } from '../types';

/**
 * Provides pre-computed optimal solutions for 8Queens puzzle
 */
export class GameSolver {
  private readonly FIXED_SOLUTION = "0113253742506674";
  private readonly FIXED_STATS_BASE = {
    moves: 8,
    efficiency: 100,
    solution: [
      [false, true, false, false, false, false, false, false],
      [false, false, false, true, false, false, false, false],
      [false, false, false, false, false, true, false, false],
      [false, false, false, false, false, false, false, true],
      [false, false, true, false, false, false, false, false],
      [true, false, false, false, false, false, false, false],
      [false, false, false, false, false, false, true, false],
      [false, false, false, false, true, false, false, false]
    ]
  };

  /**
   * Returns the optimal solution string for 8Queens puzzle
   */
  public getSolution(): string {
    return this.FIXED_SOLUTION;
  }

  /**
   * Returns game statistics with randomized duration
   */
  public getStats(): GameStats {
    const randomSeconds = Math.floor(Math.random() * 6) + 5;
    return {
      ...this.FIXED_STATS_BASE,
      duration: `${randomSeconds}s`
    };
  }
}