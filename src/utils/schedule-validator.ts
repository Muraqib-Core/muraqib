import { CronExpressionParser } from 'cron-parser';

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
  } catch (_error) {
    console.warn(`⚠️  [Muraqib Schedule]: Invalid cron expression [${scheduleString}]. Defaulting to run immediately.`);
    return true;
  }
}