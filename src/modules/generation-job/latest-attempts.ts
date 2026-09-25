/** A retried job stays for audit; only the newest attempt of each retry chain counts. */
export function latestAttempts<T extends { id: string; parentJobId: string | null }>(jobs: T[]): T[] {
  const retried = new Set(jobs.map((job) => job.parentJobId).filter(Boolean));
  return jobs.filter((job) => !retried.has(job.id));
}
