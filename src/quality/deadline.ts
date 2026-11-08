export const advisoryBudgetMs = 5000;

export class AdvisoryDeadlineError extends Error {}

export async function withAdvisoryDeadline<T>(request: (signal: AbortSignal) => Promise<T>, budgetMs = advisoryBudgetMs): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AdvisoryDeadlineError('Advisory deadline exceeded'));
        controller.abort();
      }, budgetMs);
    });
    return await Promise.race([deadline, request(controller.signal)]);
  } finally {
    clearTimeout(timer);
  }
}
