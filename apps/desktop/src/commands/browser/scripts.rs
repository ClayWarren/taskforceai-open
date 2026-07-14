use super::{
    DesktopBrowserActionParams, DesktopBrowserAnnotationsParams,
    DesktopBrowserDeveloperCommandParams, DesktopBrowserInspectParams,
    MAX_BROWSER_INSPECT_ELEMENTS, MAX_BROWSER_INSPECT_TEXT_BYTES,
};

pub(super) const BROWSER_PREVIEW_INIT_SCRIPT: &str = r#"
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

pub(super) fn browser_action_script(params: &DesktopBrowserActionParams) -> Result<String, String> {
    validate_browser_action_params(params)?;
    let params_json = serde_json::to_string(params)
        .map_err(|error| format!("Failed to encode browser action params: {error}"))?;
    let action = params.action.trim().to_ascii_lowercase();
    if action == "selectpoint" || action == "selectarea" {
        return Ok(wrap_browser_script(&params_json, BROWSER_SELECTION_SCRIPT));
    }
    Ok(wrap_browser_script(&params_json, BROWSER_ACTION_SCRIPT))
}

pub(super) fn browser_inspect_script(
    params: &DesktopBrowserInspectParams,
) -> Result<String, String> {
    validate_browser_selector(params.selector.as_deref())?;
    let params = DesktopBrowserInspectParams {
        selector: params.selector.clone(),
        max_text_bytes: Some(
            params
                .max_text_bytes
                .unwrap_or(MAX_BROWSER_INSPECT_TEXT_BYTES)
                .min(MAX_BROWSER_INSPECT_TEXT_BYTES),
        ),
        max_elements: Some(
            params
                .max_elements
                .unwrap_or(MAX_BROWSER_INSPECT_ELEMENTS)
                .min(MAX_BROWSER_INSPECT_ELEMENTS),
        ),
    };
    let params_json = serde_json::to_string(&params)
        .map_err(|error| format!("Failed to encode browser inspect params: {error}"))?;
    Ok(wrap_browser_script(&params_json, BROWSER_INSPECT_SCRIPT))
}

pub(super) fn browser_annotations_script(
    params: &DesktopBrowserAnnotationsParams,
) -> Result<String, String> {
    if params.annotations.len() > 100 {
        return Err("Browser preview annotations are limited to 100 items.".to_string());
    }
    for annotation in &params.annotations {
        if annotation.id.len() > 256 {
            return Err("Browser preview annotation id is too long.".to_string());
        }
        if annotation.text.len() > 2_000 {
            return Err("Browser preview annotation text is too long.".to_string());
        }
        if annotation
            .target
            .as_ref()
            .is_some_and(|target| target.len() > 1_000)
        {
            return Err("Browser preview annotation target is too long.".to_string());
        }
    }
    let params_json = serde_json::to_string(params)
        .map_err(|error| format!("Failed to encode browser annotations: {error}"))?;
    Ok(wrap_browser_script(
        &params_json,
        BROWSER_ANNOTATIONS_SCRIPT,
    ))
}

pub(super) fn browser_developer_command_script(
    params: &DesktopBrowserDeveloperCommandParams,
) -> Result<String, String> {
    const METHODS: &[&str] = &[
        "Browser.startSession",
        "Browser.endSession",
        "Network.getEntries",
        "Performance.getMetrics",
        "Tracing.start",
        "Tracing.end",
        "Profiler.getProfile",
    ];
    if !METHODS.contains(&params.method.as_str()) {
        return Err("Unsupported browser developer protocol method.".to_string());
    }
    if params
        .session_id
        .as_ref()
        .is_some_and(|session_id| session_id.len() > 128)
    {
        return Err("Browser developer session id is too long.".to_string());
    }
    let params_json = serde_json::to_string(params)
        .map_err(|error| format!("Failed to encode browser developer command: {error}"))?;
    Ok(wrap_browser_script(
        &params_json,
        BROWSER_DEVELOPER_COMMAND_SCRIPT,
    ))
}

fn wrap_browser_script(params_json: &str, body: &str) -> String {
    let mut script = String::from("(() => {\nconst params = ");
    script.push_str(params_json);
    script.push_str(";\n");
    script.push_str(BROWSER_SCRIPT_HELPERS);
    script.push('\n');
    script.push_str(body);
    script.push_str("\n})()");
    script
}

fn validate_browser_action_params(params: &DesktopBrowserActionParams) -> Result<(), String> {
    validate_browser_selector(params.selector.as_deref())?;
    if params.text.as_ref().is_some_and(|text| text.len() > 20_000) {
        return Err("Browser preview text input is too long.".to_string());
    }
    if params.key.as_ref().is_some_and(|key| key.len() > 64) {
        return Err("Browser preview key input is too long.".to_string());
    }

    match params.action.trim().to_ascii_lowercase().as_str() {
        "click" | "type" | "key" | "scroll" | "wait" | "selectpoint" | "selectarea" => Ok(()),
        _ => Err("Unsupported browser preview action.".to_string()),
    }
}

fn validate_browser_selector(selector: Option<&str>) -> Result<(), String> {
    if selector.is_some_and(|selector| selector.len() > 2_000) {
        return Err("Browser preview selector is too long.".to_string());
    }
    Ok(())
}

const BROWSER_SCRIPT_HELPERS: &str = r#"
const numberOrNull = (value) => Number.isFinite(value) ? value : null;
const cleanString = (value, maxLength = 500) => {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
};
const describeRect = (rect) => ({
  x: numberOrNull(rect.x) ?? 0,
  y: numberOrNull(rect.y) ?? 0,
  width: numberOrNull(rect.width) ?? 0,
  height: numberOrNull(rect.height) ?? 0,
  top: numberOrNull(rect.top) ?? 0,
  right: numberOrNull(rect.right) ?? 0,
  bottom: numberOrNull(rect.bottom) ?? 0,
  left: numberOrNull(rect.left) ?? 0,
});
const cssPath = (element) => {
  if (!(element instanceof Element)) return null;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.localName;
    if (!part) break;
    const className = Array.from(current.classList ?? []).slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
    part += className;
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((sibling) => sibling.localName === current.localName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ') || null;
};
const describeElement = (element) => {
  if (!(element instanceof Element)) return null;
  const anyElement = element;
  return {
    tagName: element.tagName.toLowerCase(),
    id: cleanString(element.id, 128),
    classes: Array.from(element.classList ?? []).slice(0, 8),
    text: cleanString(element.innerText || element.textContent, 800),
    role: cleanString(element.getAttribute('role'), 128),
    ariaLabel: cleanString(element.getAttribute('aria-label'), 256),
    name: cleanString(element.getAttribute('name'), 128),
    href: cleanString(anyElement.href, 1024),
    value: cleanString(anyElement.value, 512),
    selector: cssPath(element),
    rect: describeRect(element.getBoundingClientRect()),
  };
};
const resolveTarget = () => {
  if (params.selector) {
    try {
      const selected = document.querySelector(params.selector);
      return { element: selected, error: selected ? null : `No element matched selector ${params.selector}.` };
    } catch (error) {
      return { element: null, error: `Invalid selector: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (Number.isFinite(params.x) && Number.isFinite(params.y)) {
    const selected = document.elementFromPoint(params.x, params.y);
    return { element: selected, error: selected ? null : `No element at ${params.x}, ${params.y}.` };
  }
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    return { element: active, error: null };
  }
  return { element: null, error: 'No target element is selected.' };
};
const result = (action, ok, message, extra = {}) => ({
  action,
  ok,
  message,
  currentUrl: String(location.href),
  selection: null,
  inspection: null,
  ...extra,
});
"#;

pub(super) const BROWSER_DIAGNOSTICS_SCRIPT: &str = r#"
(() => {
  const MAX_DIAGNOSTIC_ENTRIES = 100;
  const MAX_DIAGNOSTIC_ARGS = 4;
  const MAX_DIAGNOSTIC_SLOW_RESOURCES = 12;
  const MAX_DIAGNOSTIC_TEXT = 1000;
  const MAX_DIAGNOSTIC_ARG_TEXT = 500;
  const MAX_DIAGNOSTIC_URL = 2048;
  const MAX_DIAGNOSTIC_TITLE = 512;
  const now = Date.now();
  const read = (object, key, fallback = null) => {
    try {
      if (!object || typeof object !== 'object') return fallback;
      const value = object[key];
      return value === undefined || value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  };
  const arrayOf = (value) => Array.isArray(value) ? value : [];
  const cleanString = (value, maxLength = MAX_DIAGNOSTIC_TEXT) => {
    try {
      if (value === undefined || value === null) return '';
      return String(value).slice(0, maxLength);
    } catch (_) {
      return '[Unserializable]';
    }
  };
  const finiteNumberOrNull = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const finiteNumberOr = (value, fallback) => finiteNumberOrNull(value) ?? fallback;
  const integerOrNull = (value, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const integer = Math.trunc(number);
    return integer >= min && integer <= max ? integer : null;
  };
  const sanitizeLogEntry = (entry) => ({
    level: cleanString(read(entry, 'level', 'log'), 16) || 'log',
    message: cleanString(read(entry, 'message', ''), MAX_DIAGNOSTIC_TEXT),
    args: arrayOf(read(entry, 'args', []))
      .slice(0, MAX_DIAGNOSTIC_ARGS)
      .map((value) => cleanString(value, MAX_DIAGNOSTIC_ARG_TEXT)),
    timestamp: finiteNumberOr(read(entry, 'timestamp', now), now),
  });
  const sanitizeNetworkEntry = (entry) => ({
    type: cleanString(read(entry, 'type', 'request'), 16) || 'request',
    method: cleanString(read(entry, 'method', 'GET'), 16) || 'GET',
    url: cleanString(read(entry, 'url', ''), MAX_DIAGNOSTIC_URL),
    status: integerOrNull(read(entry, 'status', null), 0, 999),
    ok: typeof read(entry, 'ok', null) === 'boolean' ? read(entry, 'ok', null) : null,
    durationMs: finiteNumberOrNull(read(entry, 'durationMs', null)),
    error: read(entry, 'error', null) === null ? null : cleanString(read(entry, 'error', ''), MAX_DIAGNOSTIC_TEXT),
    timestamp: finiteNumberOr(read(entry, 'timestamp', now), now),
  });
  const sanitizeErrorEntry = (entry) => ({
    message: cleanString(read(entry, 'message', ''), MAX_DIAGNOSTIC_TEXT),
    source: read(entry, 'source', null) === null ? null : cleanString(read(entry, 'source', ''), MAX_DIAGNOSTIC_URL),
    line: integerOrNull(read(entry, 'line', null), 0, 4294967295),
    column: integerOrNull(read(entry, 'column', null), 0, 4294967295),
    stack: read(entry, 'stack', null) === null ? null : cleanString(read(entry, 'stack', ''), MAX_DIAGNOSTIC_TEXT),
    timestamp: finiteNumberOr(read(entry, 'timestamp', now), now),
  });
  const sanitizePerformance = (performanceValue) => {
    const navigation = read(performanceValue, 'navigation', null);
    return {
      navigation: navigation ? {
        type: read(navigation, 'type', null) === null ? null : cleanString(read(navigation, 'type', ''), 64),
        durationMs: finiteNumberOrNull(read(navigation, 'durationMs', null)),
        domContentLoadedMs: finiteNumberOrNull(read(navigation, 'domContentLoadedMs', null)),
        loadEventMs: finiteNumberOrNull(read(navigation, 'loadEventMs', null)),
      } : null,
      resourceCount: integerOrNull(read(performanceValue, 'resourceCount', 0), 0, 1000000) ?? 0,
      slowResources: arrayOf(read(performanceValue, 'slowResources', []))
        .slice(0, MAX_DIAGNOSTIC_SLOW_RESOURCES)
        .map((entry) => ({
          name: cleanString(read(entry, 'name', ''), MAX_DIAGNOSTIC_URL),
          initiatorType: read(entry, 'initiatorType', null) === null ? null : cleanString(read(entry, 'initiatorType', ''), 64),
          durationMs: finiteNumberOrNull(read(entry, 'durationMs', null)),
          transferSize: finiteNumberOrNull(read(entry, 'transferSize', null)),
        })),
    };
  };
  const fallbackDiagnostics = (message = 'Browser preview diagnostics are not installed on this page.') => ({
    url: cleanString(location.href, MAX_DIAGNOSTIC_URL),
    title: cleanString(document.title || '', MAX_DIAGNOSTIC_TITLE),
    capturedAt: now,
    startedAt: now,
    logs: [],
    network: [],
    errors: [{
      message,
      source: 'taskforceai',
      line: null,
      column: null,
      stack: null,
      timestamp: now,
    }],
    performance: { navigation: null, resourceCount: 0, slowResources: [] },
  });
  const sanitizeDiagnostics = (raw) => ({
    url: cleanString(read(raw, 'url', location.href), MAX_DIAGNOSTIC_URL),
    title: cleanString(read(raw, 'title', document.title || ''), MAX_DIAGNOSTIC_TITLE),
    capturedAt: finiteNumberOr(read(raw, 'capturedAt', now), now),
    startedAt: finiteNumberOr(read(raw, 'startedAt', now), now),
    logs: arrayOf(read(raw, 'logs', [])).slice(-MAX_DIAGNOSTIC_ENTRIES).map(sanitizeLogEntry),
    network: arrayOf(read(raw, 'network', [])).slice(-MAX_DIAGNOSTIC_ENTRIES).map(sanitizeNetworkEntry),
    errors: arrayOf(read(raw, 'errors', [])).slice(-MAX_DIAGNOSTIC_ENTRIES).map(sanitizeErrorEntry),
    performance: sanitizePerformance(read(raw, 'performance', {})),
  });
  const helper = window.__TASKFORCEAI_BROWSER_PREVIEW__;
  if (!helper?.getDiagnostics) {
    return fallbackDiagnostics();
  }
  try {
    return sanitizeDiagnostics(helper.getDiagnostics());
  } catch (error) {
    return fallbackDiagnostics(`Browser preview diagnostics failed: ${cleanString(error?.message || error, MAX_DIAGNOSTIC_TEXT)}`);
  }
})()
"#;

pub(super) const BROWSER_DIAGNOSTICS_CLEAR_SCRIPT: &str = r#"
(() => {
  const helper = window.__TASKFORCEAI_BROWSER_PREVIEW__;
  if (!helper?.clearDiagnostics) {
    return {
      action: 'diagnosticsClear',
      ok: false,
      message: 'Browser preview diagnostics are not installed on this page.',
      currentUrl: String(location.href),
      selection: null,
      inspection: null,
    };
  }
  helper.clearDiagnostics();
  return {
    action: 'diagnosticsClear',
    ok: true,
    message: 'Cleared browser preview diagnostics.',
    currentUrl: String(location.href),
    selection: null,
    inspection: null,
  };
})()
"#;

const BROWSER_DEVELOPER_COMMAND_SCRIPT: &str = r#"
const helper = window.__TASKFORCEAI_BROWSER_PREVIEW__;
if (!helper?.developerCommand) {
  throw new Error('Browser developer protocol is not installed on this page. Reload the preview and try again.');
}
return helper.developerCommand(params);
"#;

const BROWSER_ACTION_SCRIPT: &str = r#"
const action = String(params.action || '').toLowerCase();
if (action === 'click') {
  const { element, error } = resolveTarget();
  if (!element) return result(action, false, error);
  const rect = element.getBoundingClientRect();
  const x = Number.isFinite(params.x) ? params.x : rect.left + rect.width / 2;
  const y = Number.isFinite(params.y) ? params.y : rect.top + rect.height / 2;
  element.focus?.({ preventScroll: true });
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
    }));
  }
  return result(action, true, 'Clicked browser preview target.', { selection: { mode: 'point', point: { x, y }, rect: describeRect(rect), element: describeElement(element) } });
}
if (action === 'type') {
  const text = String(params.text ?? '');
  const { element, error } = resolveTarget();
  if (!element) return result(action, false, error);
  element.focus?.();
  const anyElement = element;
  if (typeof anyElement.value === 'string') {
    const start = Number.isFinite(anyElement.selectionStart) ? anyElement.selectionStart : anyElement.value.length;
    const end = Number.isFinite(anyElement.selectionEnd) ? anyElement.selectionEnd : start;
    anyElement.value = `${anyElement.value.slice(0, start)}${text}${anyElement.value.slice(end)}`;
    const next = start + text.length;
    anyElement.setSelectionRange?.(next, next);
    anyElement.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    anyElement.dispatchEvent(new Event('change', { bubbles: true }));
    return result(action, true, 'Typed into browser preview target.', { selection: { mode: 'point', point: null, rect: describeRect(element.getBoundingClientRect()), element: describeElement(element) } });
  }
  if (element.isContentEditable) {
    document.execCommand?.('insertText', false, text);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return result(action, true, 'Typed into editable browser preview target.', { selection: { mode: 'point', point: null, rect: describeRect(element.getBoundingClientRect()), element: describeElement(element) } });
  }
  return result(action, false, 'Browser preview target is not editable.');
}
if (action === 'key') {
  const key = String(params.key ?? '');
  if (!key) return result(action, false, 'Browser preview key is required.');
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
  target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key }));
  return result(action, true, `Sent ${key} to browser preview.`);
}
if (action === 'scroll') {
  const deltaX = Number.isFinite(params.deltaX) ? params.deltaX : 0;
  const deltaY = Number.isFinite(params.deltaY) ? params.deltaY : 500;
  const { element } = resolveTarget();
  const scrollTarget = element && element.scrollBy ? element : window;
  scrollTarget.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
  return result(action, true, 'Scrolled browser preview.', { selection: element ? { mode: 'point', point: null, rect: describeRect(element.getBoundingClientRect()), element: describeElement(element) } : null });
}
return result(action, false, 'Unsupported browser preview action.');
"#;

const BROWSER_SELECTION_SCRIPT: &str = r#"
const action = String(params.action || '').toLowerCase();
const mode = action === 'selectarea' || params.mode === 'area' ? 'area' : 'point';
return new Promise((resolve) => {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'cursor:crosshair',
    'background:rgba(16,185,129,0.06)',
    'pointer-events:auto',
  ].join(';');
  const hint = document.createElement('div');
  hint.textContent = mode === 'area' ? 'Drag to select a Browser preview area' : 'Click to select a Browser preview element';
  hint.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:50%',
    'transform:translateX(-50%)',
    'font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'background:rgba(2,6,23,0.92)',
    'color:white',
    'border:1px solid rgba(148,163,184,0.45)',
    'border-radius:6px',
    'padding:6px 9px',
    'pointer-events:none',
  ].join(';');
  overlay.appendChild(hint);
  let selectionBox = null;
  let start = null;
  let settled = false;
  let selectionTimeout = null;
  const cleanup = () => {
    if (selectionTimeout !== null) clearTimeout(selectionTimeout);
    document.removeEventListener('keydown', cancelSelection, true);
    overlay.remove();
  };
  const cancelSelection = (event) => {
    if (settled || (event && event.key && event.key !== 'Escape')) return;
    settled = true;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    cleanup();
    resolve(result(mode === 'area' ? 'selectArea' : 'selectPoint', false, event ? 'Browser preview selection cancelled.' : 'Browser preview selection timed out.'));
  };
  const finishPoint = (event) => {
    if (settled) return;
    settled = true;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    cleanup();
    resolve(result('selectPoint', true, 'Selected browser preview element.', {
      selection: {
        mode: 'point',
        point: { x: event.clientX, y: event.clientY },
        rect: element ? describeRect(element.getBoundingClientRect()) : null,
        element: describeElement(element),
      },
    }));
  };
  const finishArea = (event) => {
    if (settled || !start) return;
    settled = true;
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const element = document.elementFromPoint(centerX, centerY);
    cleanup();
    resolve(result('selectArea', true, 'Selected browser preview area.', {
      selection: {
        mode: 'area',
        point: { x: centerX, y: centerY },
        rect: { x: left, y: top, width, height, top, right: left + width, bottom: top + height, left },
        element: describeElement(element),
      },
    }));
  };
  if (mode === 'area') {
    overlay.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      start = { x: event.clientX, y: event.clientY };
      selectionBox = document.createElement('div');
      selectionBox.style.cssText = [
        'position:fixed',
        'border:2px solid rgb(16,185,129)',
        'background:rgba(16,185,129,0.16)',
        'pointer-events:none',
      ].join(';');
      overlay.appendChild(selectionBox);
    }, true);
    overlay.addEventListener('mousemove', (event) => {
      if (!start || !selectionBox) return;
      const left = Math.min(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      const width = Math.abs(event.clientX - start.x);
      const height = Math.abs(event.clientY - start.y);
      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;
    }, true);
    overlay.addEventListener('mouseup', (event) => {
      event.preventDefault();
      event.stopPropagation();
      finishArea(event);
    }, true);
  } else {
    overlay.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      finishPoint(event);
    }, true);
  }
  document.addEventListener('keydown', cancelSelection, true);
  document.documentElement.appendChild(overlay);
  selectionTimeout = setTimeout(() => cancelSelection(null), 55000);
});
"#;

const BROWSER_INSPECT_SCRIPT: &str = r#"
const maxTextBytes = Math.max(0, Math.min(Number(params.maxTextBytes ?? 32768), 32768));
const maxElements = Math.max(1, Math.min(Number(params.maxElements ?? 60), 60));
let elements = [];
if (params.selector) {
  try {
    elements = Array.from(document.querySelectorAll(params.selector)).slice(0, maxElements);
  } catch (_) {
    elements = [];
  }
} else {
  elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[aria-label],[data-testid]')).slice(0, maxElements);
}
const text = cleanString(document.body?.innerText || document.documentElement?.textContent || '', maxTextBytes);
return {
  title: document.title || '',
  url: String(location.href),
  readyState: document.readyState || '',
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio || 1,
  },
  scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
  activeElement: describeElement(document.activeElement),
  elements: elements.map(describeElement).filter(Boolean),
  text,
};
"#;

const BROWSER_ANNOTATIONS_SCRIPT: &str = r#"
document.getElementById('__taskforceai_browser_annotations__')?.remove();
const annotations = Array.isArray(params.annotations) ? params.annotations.slice(0, 100) : [];
if (annotations.length === 0) {
  return result('annotations', true, 'Cleared browser preview annotations.');
}
const layer = document.createElement('div');
layer.id = '__taskforceai_browser_annotations__';
layer.style.cssText = [
  'position:fixed',
  'inset:0',
  'z-index:2147483646',
  'pointer-events:none',
  'font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
].join(';');
annotations.forEach((annotation, index) => {
  const hasPoint = Number.isFinite(annotation.x) && Number.isFinite(annotation.y);
  const width = Number.isFinite(annotation.width) ? Math.max(annotation.width, 0) : 0;
  const height = Number.isFinite(annotation.height) ? Math.max(annotation.height, 0) : 0;
  const label = String(annotation.text || annotation.target || `Annotation ${index + 1}`).slice(0, 140);
  const color = 'rgb(16,185,129)';
  const badge = document.createElement('div');
  badge.textContent = `${index + 1}. ${label}`;
  badge.style.cssText = [
    'position:fixed',
    'max-width:280px',
    'background:rgba(2,6,23,0.94)',
    'color:white',
    'border:1px solid rgba(16,185,129,0.7)',
    'border-radius:6px',
    'padding:5px 7px',
    'box-shadow:0 10px 24px rgba(0,0,0,0.25)',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'white-space:nowrap',
  ].join(';');
  if (hasPoint && (width > 0 || height > 0 || annotation.kind === 'area')) {
    const rect = document.createElement('div');
    rect.style.cssText = [
      'position:fixed',
      `left:${annotation.x}px`,
      `top:${annotation.y}px`,
      `width:${Math.max(width, 28)}px`,
      `height:${Math.max(height, 28)}px`,
      `border:2px solid ${color}`,
      'background:rgba(16,185,129,0.14)',
      'box-shadow:0 0 0 9999px rgba(15,23,42,0.03)',
    ].join(';');
    layer.appendChild(rect);
    badge.style.left = `${annotation.x}px`;
    badge.style.top = `${Math.max(0, annotation.y - 32)}px`;
  } else if (hasPoint) {
    const marker = document.createElement('div');
    marker.style.cssText = [
      'position:fixed',
      `left:${annotation.x - 7}px`,
      `top:${annotation.y - 7}px`,
      'width:14px',
      'height:14px',
      `background:${color}`,
      'border:2px solid white',
      'border-radius:999px',
      'box-shadow:0 3px 12px rgba(0,0,0,0.35)',
    ].join(';');
    layer.appendChild(marker);
    badge.style.left = `${annotation.x + 10}px`;
    badge.style.top = `${Math.max(0, annotation.y - 14)}px`;
  } else {
    badge.style.right = '12px';
    badge.style.top = `${12 + index * 34}px`;
  }
  layer.appendChild(badge);
});
document.documentElement.appendChild(layer);
return result('annotations', true, `Rendered ${annotations.length} browser preview annotation${annotations.length === 1 ? '' : 's'}.`);
"#;
