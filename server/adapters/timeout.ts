export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  message: string
): Promise<Response> {
  const controller = new AbortController();
  try {
    return await withTimeout(
      fetch(input, { ...(init ?? {}), signal: controller.signal }),
      timeoutMs,
      message,
      () => controller.abort()
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(message);
    }
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
