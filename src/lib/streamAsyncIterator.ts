// Lets `for await (const chunk of stream)` work on a ReadableStream that hasn't
// got an async iterator of its own.
//
// Safari only made ReadableStream async-iterable in 17.4 (March 2024). pdf.js
// reads a page's text with `for await (const value of readableStream)` inside
// getTextContent, so on an older iPhone every plan upload died there with
// Safari's "undefined is not a function", and the upload screen relayed it.
//
// The legacy pdf.js build doesn't cover this. It's transpiled and carries
// polyfills — including hand-written ones for Response.prototype.bytes and
// AbortSignal.any, the same shape as this — but async iteration of a stream is
// a property of the browser's ReadableStream, not of the language, so nothing
// Babel or core-js does can supply it. It has to be added to the prototype.
//
// This is the async iterator from the streams spec: next() reads, return()
// cancels the stream unless the caller asked it not to, and both `values` and
// the well-known symbol point at it, because that's how a browser that has it
// exposes it.

type StreamIteratorOptions = { preventCancel?: boolean };

/**
 * Add the async iterator to ReadableStream.prototype if it's missing.
 *
 * Safe to call any number of times, and a no-op on every browser that already
 * has it — which, in a few years' time, will be all of them.
 */
export function installStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return;
  const proto = ReadableStream.prototype as ReadableStream & {
    values?: unknown;
    [Symbol.asyncIterator]?: unknown;
  };
  if (typeof proto[Symbol.asyncIterator] === 'function') return;

  function values<R>(
    this: ReadableStream<R>,
    { preventCancel = false }: StreamIteratorOptions = {}
  ): AsyncIterableIterator<R> {
    const reader = this.getReader();
    return {
      next: () => reader.read() as Promise<IteratorResult<R>>,
      async return(value?: unknown) {
        // Breaking out of the loop early has to let the producer go, or pdf.js
        // would leave a page's text stream open behind it.
        if (!preventCancel) await reader.cancel(value);
        reader.releaseLock();
        return { done: true, value } as IteratorResult<R>;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  const descriptor = { value: values, writable: true, configurable: true, enumerable: false };
  Object.defineProperty(proto, 'values', descriptor);
  Object.defineProperty(proto, Symbol.asyncIterator, descriptor);
}
