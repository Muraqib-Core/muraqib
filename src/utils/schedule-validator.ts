import { CronExpressionParser } from 'cron-parser';
import * as logger from "../shared/logger.js";

/**
 * Whether the audit should run now for a schedule.
 *
 * - Empty or missing: always run.
 * - `on weekends`: Friday, Saturday and Sunday.
 * - A cron expression: run when its most recent occurrence was within the last 60 minutes.
 * - An invalid cron expression: warn and run (fail open), so a typo never silently disables the audit.
 *
 * @param scheduleString - Schedule to evaluate
 * @returns True when the audit may run
 */
export function isWithinSchedule(scheduleString?: string): boolean {
  if (!scheduleString || scheduleString.trim() === '') {
    return true;
  }

  const now = new Date();
  const currentDay = now.getDay();

  if (scheduleString.toLowerCase() === 'on weekends') {
    return currentDay === 5 || currentDay === 6 || currentDay === 0;
  }

  try {
    const interval = CronExpressionParser.parse(scheduleString);
    const prevExecution = interval.prev().toDate();
    const diffInMinutes = Math.abs(now.getTime() - prevExecution.getTime()) / (1000 * 60);

    if (diffInMinutes <= 60) {
      return true;
    }
    return false;
  } catch {
    logger.warn(`⚠️  [Muraqib Schedule]: Invalid cron expression [${scheduleString}]. Defaulting to run immediately.`);
    return true;
  }
}