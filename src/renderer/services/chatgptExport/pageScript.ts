/**
 * One step of the export, run inside the ChatGPT page. `workspaceId` selects a team
 * workspace (sent as `ChatGPT-Account-Id`); `null` exports the personal account.
 */
export type ChatgptPageRequest =
  | { op: 'detect'; workspaceId: null }
  | { op: 'list'; workspaceId: string | null }
  | { op: 'fetch'; workspaceId: string | null; ids: string[] }

/**
 * Runs in the page's own context so `fetch` carries the signed-in session; the host only
 * receives the JSON result. Every failure resolves to `{ ok: false, error }` with a stable
 * code. A literal string rather than `fn.toString()`, so bundling can never change what runs.
 */
const PAGE_SCRIPT = String.raw`async (request) => {
  const PAGE_SIZE = 50;
  const ID_PATTERN = /^[\w-]{1,128}$/;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pause = () => sleep(150 + Math.random() * 100);
  const fail = (code) => Object.assign(new Error(code), { code: code });

  const getJson = async (path, headers) => {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetch(path, { headers: headers || {}, credentials: 'include' });
      } catch (error) {
        if (attempt >= 3) throw fail('network');
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (response.ok) return await response.json();
      if (response.status === 401) throw fail('not_signed_in');
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw fail('http_' + response.status);
    }
  };

  const buildHeaders = (token, workspaceId) => {
    const headers = { Authorization: 'Bearer ' + token };
    const deviceId = (document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/) || [])[1];
    if (deviceId) headers['oai-device-id'] = deviceId;
    if (workspaceId) headers['ChatGPT-Account-Id'] = workspaceId;
    return headers;
  };

  const detectWorkspaces = async (headers) => {
    const found = new Map();
    const add = (id, name) => {
      if (typeof id === 'string' && ID_PATTERN.test(id) && !found.get(id)) {
        found.set(id, typeof name === 'string' && name ? name : null);
      }
    };
    try {
      const data = await getJson('/backend-api/accounts/check/v4-2023-04-27', headers);
      Object.values((data && data.accounts) || {}).forEach((entry) => {
        const account = entry && entry.account;
        if (account && account.structure === 'workspace') add(account.account_id, account.name);
      });
    } catch (error) {}
    try {
      const next = JSON.parse((document.getElementById('__NEXT_DATA__') || {}).textContent || '{}');
      const accounts = (((next.props || {}).pageProps || {}).user || {}).accounts || {};
      Object.values(accounts).forEach((entry) => add(entry && entry.account && entry.account.id));
    } catch (error) {}
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!key.includes('account') && !key.includes('workspace')) continue;
        const value = String(localStorage.getItem(key) || '').replace(/"/g, '');
        if (/^(ws-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) add(value);
      }
    } catch (error) {}
    return Array.from(found, ([id, name]) => ({ id: id, name: name }));
  };

  const listIds = async (headers) => {
    const ids = new Set();
    const addAll = (items) => {
      let added = 0;
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (item && typeof item.id === 'string' && !ids.has(item.id)) {
          ids.add(item.id);
          added += 1;
        }
      });
      return added;
    };

    const listPages = async (archived) => {
      for (let offset = 0; ; ) {
        const page = await getJson(
          '/backend-api/conversations?offset=' + offset + '&limit=' + PAGE_SIZE + '&order=updated' +
            (archived ? '&is_archived=true' : ''),
          headers
        );
        const items = Array.isArray(page && page.items) ? page.items : [];
        if (addAll(items) === 0) return;
        offset += items.length;
        const hasMore =
          typeof page.has_more === 'boolean'
            ? page.has_more
            : typeof page.total === 'number'
              ? offset < page.total
              : items.length >= PAGE_SIZE;
        if (!hasMore) return;
        await pause();
      }
    };
    const listProjectPages = async (projectId) => {
      for (let cursor = '0'; cursor; ) {
        const page = await getJson(
          '/backend-api/gizmos/' + encodeURIComponent(projectId) + '/conversations?cursor=' +
            encodeURIComponent(cursor),
          headers
        );
        if (addAll(page && page.items) === 0) return;
        cursor = page && page.cursor ? String(page.cursor) : null;
        await pause();
      }
    };
    const listProjectIds = async () => {
      const projectIds = [];
      for (let cursor = null; ; ) {
        const page = await getJson(
          '/backend-api/gizmos/snorlax/sidebar' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
          headers
        );
        let added = 0;
        (Array.isArray(page && page.items) ? page.items : []).forEach((item) => {
          const gizmo = item && item.gizmo && (item.gizmo.gizmo || item.gizmo);
          if (gizmo && typeof gizmo.id === 'string' && !projectIds.includes(gizmo.id)) {
            projectIds.push(gizmo.id);
            added += 1;
          }
        });
        cursor = page && typeof page.cursor === 'string' ? page.cursor : null;
        if (!cursor || added === 0) return projectIds;
        await pause();
      }
    };
    // Archived and project conversations are extras: failing to list them must not lose the rest.
    const optional = async (task) => {
      try {
        return await task();
      } catch (error) {
        if (error.code === 'not_signed_in') throw error;
        return null;
      }
    };

    await listPages(false);
    await optional(() => listPages(true));
    // Conversations inside projects are missing from the main list.
    for (const projectId of (await optional(listProjectIds)) || []) {
      await optional(() => listProjectPages(projectId));
    }
    return Array.from(ids);
  };

  const fetchConversations = async (headers, ids) => {
    const conversations = [];
    const failed = [];
    for (const id of ids) {
      try {
        const detail = await getJson('/backend-api/conversation/' + encodeURIComponent(id), headers);
        if (detail && detail.mapping && typeof detail.mapping === 'object') conversations.push(detail);
        else failed.push(id);
      } catch (error) {
        if (error.code === 'not_signed_in') throw error;
        failed.push(id);
      }
      await pause();
    }
    return { conversations: conversations, failed: failed };
  };

  try {
    if (location.origin !== 'https://chatgpt.com') return { ok: false, error: 'wrong_page' };
    const session = await getJson('/api/auth/session');
    if (!session || typeof session.accessToken !== 'string') return { ok: false, error: 'not_signed_in' };
    const headers = buildHeaders(session.accessToken, request.workspaceId);
    if (request.op === 'detect') return { ok: true, workspaces: await detectWorkspaces(headers) };
    if (request.op === 'list') return { ok: true, ids: await listIds(headers) };
    if (request.op === 'fetch') return Object.assign({ ok: true }, await fetchConversations(headers, request.ids));
    return { ok: false, error: 'unexpected' };
  } catch (error) {
    return { ok: false, error: (error && error.code) || 'unexpected' };
  }
}`

/** The complete expression to pass to `<webview>.executeJavaScript`; the request travels as JSON data. */
export function buildChatgptPageScript(request: ChatgptPageRequest): string {
  return `(${PAGE_SCRIPT})(${JSON.stringify(request)})`
}
