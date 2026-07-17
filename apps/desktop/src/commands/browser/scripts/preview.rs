pub(crate) const BROWSER_PREVIEW_INIT_SCRIPT: &str = r#"
(() => {
  try {
    if (!window.__TASKFORCEAI_BROWSER_PREVIEW__?.__installed) {
      const maxEntries = 200;
      const maxTextLength = 2000;
      const maxUrlLength = 4096;
      const maxTitleLength = 512;
      const state = {
        logs: [],
        network: [],
        errors: [],
        startedAt: Date.now(),
        developer: {
          sessionId: null,
          captureBodies: false,
          maxBodyBytes: 8192,
          traceStartedAt: null,
          traceEntries: [],
        },
      };
      const trim = (items) => {
        while (items.length > maxEntries) items.shift();
      };
      const safeString = (value, maxLength = maxTextLength) => {
        try {
          if (value === undefined || value === null) return '';
          return String(value).slice(0, maxLength);
        } catch (_) {
          return '[Unserializable]';
        }
      };
      const safeUrl = (value) => safeString(value, maxUrlLength);
      const safeTitle = (value) => safeString(value, maxTitleLength);
      const safeText = (value, depth = 0) => {
        try {
          if (value instanceof Error) return safeString(`${value.name}: ${value.message}`);
          if (typeof value === 'string') return safeString(value);
          if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
          if (depth > 1) return '[Object]';
          if (Array.isArray(value)) return `[${value.slice(0, 8).map((item) => safeText(item, depth + 1)).join(', ')}]`;
          if (typeof value === 'object') {
            const out = {};
            for (const key of Object.keys(value).slice(0, 12)) {
              out[key] = safeText(value[key], depth + 1);
            }
            return safeString(JSON.stringify(out));
          }
          return safeString(value);
        } catch (_) {
          return '[Unserializable]';
        }
      };
      const recordLog = (level, args) => {
        state.logs.push({
          level,
          message: Array.from(args).map((arg) => safeText(arg)).join(' '),
          args: Array.from(args).slice(0, 8).map((arg) => safeText(arg)),
          timestamp: Date.now(),
        });
        trim(state.logs);
      };
      for (const level of ['debug', 'info', 'log', 'warn', 'error']) {
        const original = console[level]?.bind(console);
        if (original && !console[level]?.__taskforceaiWrapped) {
          const wrapped = (...args) => {
            recordLog(level, args);
            return original(...args);
          };
          wrapped.__taskforceaiWrapped = true;
          console[level] = wrapped;
        }
      }
      window.addEventListener('error', (event) => {
        state.errors.push({
          message: safeText(event.message),
          source: safeUrl(event.filename) || null,
          line: event.lineno || null,
          column: event.colno || null,
          stack: safeText(event.error?.stack ?? event.error),
          timestamp: Date.now(),
        });
        trim(state.errors);
      });
      window.addEventListener('unhandledrejection', (event) => {
        state.errors.push({
          message: safeText(event.reason),
          source: 'unhandledrejection',
          line: null,
          column: null,
          stack: safeText(event.reason?.stack),
          timestamp: Date.now(),
        });
        trim(state.errors);
      });
      if (typeof window.fetch === 'function' && !window.fetch.__taskforceaiWrapped) {
        const originalFetch = window.fetch.bind(window);
        const wrappedFetch = async (...args) => {
          const started = performance.now();
          const input = args[0];
          const method = String(args[1]?.method ?? input?.method ?? 'GET').toUpperCase();
          const url = safeUrl(input?.url ?? input ?? '');
          try {
            const response = await originalFetch(...args);
            const entry = {
              type: 'fetch',
              method,
              url,
              status: response.status,
              ok: response.ok,
              durationMs: Math.round((performance.now() - started) * 10) / 10,
              error: null,
              timestamp: Date.now(),
              sessionId: state.developer.sessionId,
              requestBody: null,
              responseBody: null,
              bodyTruncated: false,
            };
            if (state.developer.sessionId && state.developer.captureBodies) {
              const requestBody = args[1]?.body;
              if (typeof requestBody === 'string') {
                entry.requestBody = safeString(requestBody, state.developer.maxBodyBytes);
                entry.bodyTruncated ||= requestBody.length > state.developer.maxBodyBytes;
              }
              try {
                const resolvedUrl = new URL(url, location.href);
                const contentType = response.headers.get('content-type') || '';
                if (resolvedUrl.origin === location.origin && /(?:json|text|javascript|xml|html|css)/i.test(contentType)) {
                  const maxBodyBytes = state.developer.maxBodyBytes;
                  void response.clone().text().then((responseText) => {
                    entry.responseBody = safeString(responseText, maxBodyBytes);
                    entry.bodyTruncated ||= responseText.length > maxBodyBytes;
                  }).catch(() => {});
                }
              } catch (_) {}
            }
            state.network.push(entry);
            trim(state.network);
            return response;
          } catch (error) {
            state.network.push({
              type: 'fetch',
              method,
              url,
              status: null,
              ok: false,
              durationMs: Math.round((performance.now() - started) * 10) / 10,
              error: safeText(error),
              timestamp: Date.now(),
              sessionId: state.developer.sessionId,
              requestBody: null,
              responseBody: null,
              bodyTruncated: false,
            });
            trim(state.network);
            throw error;
          }
        };
        wrappedFetch.__taskforceaiWrapped = true;
        window.fetch = wrappedFetch;
      }
      if (window.XMLHttpRequest?.prototype && !window.XMLHttpRequest.prototype.__taskforceaiWrapped) {
        const originalOpen = window.XMLHttpRequest.prototype.open;
        const originalSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__taskforceaiRequest = {
            method: String(method || 'GET').toUpperCase(),
            url: safeUrl(url || ''),
          };
          return originalOpen.call(this, method, url, ...rest);
        };
        window.XMLHttpRequest.prototype.send = function(...args) {
          const started = performance.now();
          const request = this.__taskforceaiRequest ?? { method: 'GET', url: '' };
          this.addEventListener('loadend', () => {
            state.network.push({
              type: 'xhr',
              method: request.method,
              url: request.url,
              status: this.status || null,
              ok: this.status >= 200 && this.status < 400,
              durationMs: Math.round((performance.now() - started) * 10) / 10,
              error: null,
              timestamp: Date.now(),
              sessionId: state.developer.sessionId,
              requestBody: state.developer.sessionId && state.developer.captureBodies && typeof args[0] === 'string'
                ? safeString(args[0], state.developer.maxBodyBytes)
                : null,
              responseBody: state.developer.sessionId && state.developer.captureBodies && (!this.responseType || this.responseType === 'text')
                ? safeString(this.responseText || '', state.developer.maxBodyBytes)
                : null,
              bodyTruncated: false,
            });
            trim(state.network);
          }, { once: true });
          this.addEventListener('error', () => {
            state.network.push({
              type: 'xhr',
              method: request.method,
              url: request.url,
              status: this.status || null,
              ok: false,
              durationMs: Math.round((performance.now() - started) * 10) / 10,
              error: 'XMLHttpRequest error',
              timestamp: Date.now(),
              sessionId: state.developer.sessionId,
              requestBody: null,
              responseBody: null,
              bodyTruncated: false,
            });
            trim(state.network);
          }, { once: true });
          return originalSend.apply(this, args);
        };
        window.XMLHttpRequest.prototype.__taskforceaiWrapped = true;
      }
      try {
        const observer = new PerformanceObserver((list) => {
          if (!state.developer.sessionId || state.developer.traceStartedAt === null) return;
          for (const entry of list.getEntries()) {
            state.developer.traceEntries.push({
              name: safeString(entry.name, 512),
              entryType: safeString(entry.entryType, 64),
              startTime: Math.round(entry.startTime * 10) / 10,
              durationMs: Math.round(entry.duration * 10) / 10,
              detail: entry.detail === undefined ? null : safeText(entry.detail),
            });
          }
          while (state.developer.traceEntries.length > 1000) state.developer.traceEntries.shift();
        });
        const supported = PerformanceObserver.supportedEntryTypes ?? [];
        const entryTypes = ['longtask', 'measure', 'mark', 'resource', 'navigation']
          .filter((entryType) => supported.includes(entryType));
        if (entryTypes.length) observer.observe({ entryTypes, buffered: false });
      } catch (_) {}
      const helper = Object.freeze({
          __installed: true,
          getDiagnostics() {
            const navigation = performance.getEntriesByType?.('navigation')?.[0];
            const resources = performance.getEntriesByType?.('resource') ?? [];
            return {
              url: safeUrl(location.href),
              title: safeTitle(document.title || ''),
              capturedAt: Date.now(),
              startedAt: state.startedAt,
              logs: state.logs.slice(),
              network: state.network.slice(),
              errors: state.errors.slice(),
              performance: {
                navigation: navigation ? {
                  type: navigation.type || null,
                  durationMs: Math.round(navigation.duration * 10) / 10,
                  domContentLoadedMs: Math.round((navigation.domContentLoadedEventEnd || 0) * 10) / 10,
                  loadEventMs: Math.round((navigation.loadEventEnd || 0) * 10) / 10,
                } : null,
                resourceCount: resources.length,
                slowResources: resources
                  .slice()
                  .sort((a, b) => b.duration - a.duration)
                  .slice(0, 12)
                  .map((entry) => ({
                    name: String(entry.name).slice(0, 1024),
                    initiatorType: entry.initiatorType || null,
                    durationMs: Math.round(entry.duration * 10) / 10,
                    transferSize: entry.transferSize || null,
                  })),
              },
            };
          },
          clearDiagnostics() {
            state.logs.length = 0;
            state.network.length = 0;
            state.errors.length = 0;
            state.startedAt = Date.now();
            return true;
          },
          developerCommand(params) {
            const method = String(params?.method || '');
            const developer = state.developer;
            const response = (result) => ({
              sessionId: developer.sessionId,
              method,
              protocol: 'cdp-compatible-webview-v1',
              active: Boolean(developer.sessionId),
              result,
            });
            if (method === 'Browser.startSession') {
              developer.sessionId = safeString(params.sessionId, 128);
              developer.captureBodies = Boolean(params.captureBodies);
              developer.maxBodyBytes = Math.max(0, Math.min(Number(params.maxBodyBytes || 8192), 32768));
              developer.traceStartedAt = null;
              developer.traceEntries.length = 0;
              state.network.length = 0;
              return response({
                supportedDomains: ['Network', 'Performance', 'Tracing', 'Profiler'],
                captureBodies: developer.captureBodies,
                maxBodyBytes: developer.maxBodyBytes,
              });
            }
            if (!developer.sessionId || params.sessionId !== developer.sessionId) {
              throw new Error('Browser developer session is missing or does not match.');
            }
            if (method === 'Browser.endSession') {
              const sessionId = developer.sessionId;
              developer.sessionId = null;
              developer.captureBodies = false;
              developer.traceStartedAt = null;
              return {
                sessionId,
                method,
                protocol: 'cdp-compatible-webview-v1',
                active: false,
                result: { ended: true },
              };
            }
            if (method === 'Network.getEntries') {
              const allEntries = state.network.filter((entry) => entry.sessionId === developer.sessionId);
              const limit = developer.captureBodies ? 20 : 200;
              return response({
                entries: allEntries.slice(-limit),
                truncated: allEntries.length > limit,
              });
            }
            if (method === 'Performance.getMetrics') {
              const navigation = performance.getEntriesByType('navigation')[0] ?? null;
              const resources = performance.getEntriesByType('resource');
              return response({
                timeOrigin: performance.timeOrigin,
                now: performance.now(),
                navigation: navigation ? {
                  durationMs: navigation.duration,
                  domContentLoadedMs: navigation.domContentLoadedEventEnd,
                  loadEventMs: navigation.loadEventEnd,
                } : null,
                resourceCount: resources.length,
                memory: performance.memory ? {
                  usedJsHeapSize: performance.memory.usedJSHeapSize,
                  totalJsHeapSize: performance.memory.totalJSHeapSize,
                  jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
                } : null,
              });
            }
            if (method === 'Tracing.start') {
              developer.traceEntries.length = 0;
              developer.traceStartedAt = performance.now();
              return response({ startedAt: developer.traceStartedAt });
            }
            if (method === 'Tracing.end') {
              const startedAt = developer.traceStartedAt;
              developer.traceStartedAt = null;
              return response({
                startedAt,
                endedAt: performance.now(),
                entries: developer.traceEntries.slice(),
                truncated: developer.traceEntries.length >= 1000,
              });
            }
            if (method === 'Profiler.getProfile') {
              const longTasks = performance.getEntriesByType('longtask').slice(-200).map((entry) => ({
                startTime: entry.startTime,
                durationMs: entry.duration,
                name: safeString(entry.name, 256),
              }));
              const measures = performance.getEntriesByType('measure').slice(-200).map((entry) => ({
                startTime: entry.startTime,
                durationMs: entry.duration,
                name: safeString(entry.name, 256),
              }));
              return response({ longTasks, measures, traceEntries: developer.traceEntries.slice(-500) });
            }
            throw new Error('Unsupported browser developer protocol method.');
          },
      });
      Object.defineProperty(window, '__TASKFORCEAI_BROWSER_PREVIEW__', {
        configurable: false,
        writable: false,
        value: helper,
      });
    }
    delete window.__TAURI__;
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI_IPC__;
  } catch (_) {}
})();
"#;
