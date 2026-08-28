import { AsyncLocalStorage } from "node:async_hooks";

export interface AdminActionContextStore<Context extends object> {
  get(): Context | null;
  run<Result>(
    context: Context,
    operation: () => Promise<Result>,
  ): Promise<Result>;
}

interface ActiveContext<Context extends object> {
  context: Context;
  active: boolean;
}

/**
 * Request-local carrier for a context that was verified by an exported action
 * boundary. The store itself establishes no trust; only the server-only wrapper
 * may install a verified context. A settled operation invalidates its lease so
 * detached descendants cannot retain authority after the action completes.
 * Production operations are async; the Promise boundary captures synchronous
 * throws and assimilates a returned thenable exactly once before cleanup.
 */
export function createAdminActionContextStore<
  Context extends object,
>(): AdminActionContextStore<Context> {
  const storage = new AsyncLocalStorage<ActiveContext<Context>>();
  return {
    get: () => {
      const state = storage.getStore();
      return state?.active ? state.context : null;
    },
    run: <Result>(
      context: Context,
      operation: () => Promise<Result>,
    ): Promise<Result> => {
      const snapshot = Object.freeze({ ...context }) as Context;
      const state: ActiveContext<Context> = {
        context: snapshot,
        active: true,
      };
      return storage.run(state, () =>
        Promise.resolve()
          .then(operation)
          .finally(() => {
            state.active = false;
          }),
      );
    },
  };
}
