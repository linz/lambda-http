import { performance } from 'perf_hooks';

/** Number of decimal places to keep in timers */
const TruncateTimers = 4;
/**
 * Utility to record some metrics about the execution of the function
 *
 * TODO this should be replaced by open telemetry
 */
export class Metrics {
  /**
   * Start time of all timers
   */
  timers: Map<string, { start: number; duration?: number }> = new Map();

  getTime(): number {
    return performance.now();
  }

  /**
   * Start a timer at the current time
   * @param timeName name of timer to start
   */
  public start(timeName: string): void {
    const existing = this.timers.get(timeName);
    if (existing != null && existing.duration == null) {
      throw new Error(`Duplicate startTime for "${timeName}"`);
    }
    this.timers.set(timeName, { start: this.getTime() });
  }

  /**
   * End the timer, returning the duration in milliseconds
   * @param timeName timer to end
   */
  public end(timeName: string): number {
    const timer = this.timers.get(timeName);
    if (timer == null) throw new Error(`Missing startTime information for "${timeName}"`);
    const duration = this.getTime() - timer.start;
    timer.duration = Number(duration.toFixed(TruncateTimers));
    return duration;
  }

  /** Get list of all timers that have run */
  public get metrics(): Record<string, number> | undefined {
    if (this.timers.size === 0) return undefined;
    const output: Record<string, number> = {};
    for (const [key, timer] of this.timers.entries()) {
      if (timer.duration != null) output[key] = timer.duration;
    }
    return output;
  }

  /** Get a list of timers that never finished */
  public get unfinished(): string[] | undefined {
    const st: string[] = [];
    for (const [key, timer] of this.timers.entries()) {
      if (timer.duration == null) st.push(key);
    }
    if (st.length === 0) return undefined;
    return st;
  }
}
