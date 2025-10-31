// src/utils/RequestContext.ts
import { AsyncLocalStorage } from "async_hooks";

interface ContextData {
    user?: { id: string; firstName: string; lastName: string; };
}

const storage = new AsyncLocalStorage<ContextData>();

export const RequestContext = {
    run: (data: ContextData, callback: () => Promise<any>) => {
        return storage.run(data, callback);
    },
    get: () => storage.getStore(),
};
