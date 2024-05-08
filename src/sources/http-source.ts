import type { Source } from "../dtos/source";

export type HTTPSourceOptions = {
  createFetchRequestInit?: () => Promise<FetchRequestInit> | FetchRequestInit;
  statusValidator?: (status: number) => boolean;
  /** time on ms */
  timeRefresh?: number;
  responseParser?: (response: Response) => Promise<any>;
};

const defaultHTTPSourceOptions: Required<HTTPSourceOptions> = {
  createFetchRequestInit: () => ({ method: "GET" }),
  statusValidator: (status: number) => status >= 200 && status < 300,
  timeRefresh: 300,
  responseParser: (response: Response) => response.json(),
};

class SystemCache {
  cacheEtagState: null | { etag: string } = null;
  cacheLastModifiedState: null | { lastModified: number; maxAge: number } =
    null;

  requestWith(request: Request) {
    if (this.cacheEtagState) {
      request.headers.set("If-None-Match", this.cacheEtagState.etag);
    }
    if (this.cacheLastModifiedState) {
      request.headers.set(
        "If-Modified-Since",
        new Date(
          this.cacheLastModifiedState.lastModified +
            this.cacheLastModifiedState.maxAge * 1000,
        ).toUTCString(),
      );
    }
    return request;
  }

  responseWithEtag(response: Response) {
    const etag = response.headers.get("etag");
    if (etag) {
      this.cacheEtagState = { etag: etag };
    }
  }

  responseWithLastModified(response: Response) {
    const lastModified = response.headers.get("last-modified");
    const cacheControl = response.headers.get("cache-control");
    if (lastModified) {
      const maxAge = cacheControl
        ? /max-age=(?<maxAge>\d+)/.exec(cacheControl)?.groups?.maxAge
        : null;
      this.cacheLastModifiedState = {
        lastModified: Number(new Date(lastModified)),
        maxAge: Number(maxAge ?? 3600),
      };
    }
  }

  responseWith(response: Response) {
    this.responseWithEtag(response);
    this.responseWithLastModified(response);
  }
}

export class HTTPSource<T> implements Source<T> {
  readonly abortController = new AbortController();
  private options: Required<HTTPSourceOptions>;
  private state: any = null;
  private systemCache = new SystemCache();

  constructor(
    private location: string | { toString(): string },
    options?: HTTPSourceOptions,
  ) {
    this.options = {
      ...defaultHTTPSourceOptions,
      ...options,
    };
  }

  async pullData(init: FetchRequestInit) {
    const request = new Request(`${this.location}`, init);

    this.systemCache.requestWith(request);

    const response = await fetch(request);

    if (response.status === 304) {
      return this.state;
    }

    if (!this.options.statusValidator(response.status))
      throw new Error(`Invalid code status received`);

    this.systemCache.responseWith(response);

    const state = await this.options.responseParser(response);
    this.state = state;

    return state;
  }

  async load(): Promise<T> {
    const init = await this.options.createFetchRequestInit();
    return await this.pullData(init);
  }

  async *[Symbol.asyncIterator]() {
    const asyncTimeInterval: AsyncIterableIterator<null> = {
      next: async () => {
        const promiseTimeOut = Promise.withResolvers<null>();
        setTimeout(
          () => promiseTimeOut.resolve(null),
          this.options.timeRefresh,
        );
        await promiseTimeOut.promise;
        return {
          value: null,
        };
      },
      [Symbol.asyncIterator]: () => asyncTimeInterval,
    };

    yield null;
    for await (const _ of asyncTimeInterval) {
      yield null;
    }
  }
}