/**
 * Registers every job handler. Called by the worker, and by the API process so that
 * JOBS_MODE=inline can run handlers in-process. Each module exports a `register*Jobs`
 * function; add yours here.
 */
import { registerMaintenanceJobs } from "./maintenance.jobs";
import { registerPracticeJobs } from "./practice.jobs";

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;
  registerMaintenanceJobs();
  registerPracticeJobs();
}
