/* Fixed renderer carrier for Claude Desktop 5.11492.0 / 5.11492.2. This expression is data
 * bundled by the server, never supplied by an HTTP caller. No engine spawning,
 * auth access, filesystem APIs, account APIs or automatic permission grants. */
(() => {
  'use strict';
  const key = Symbol.for('anywork.claude.desktop.carriers.v1');
  const states = globalThis[key] || (globalThis[key] = new Map());
  const localId = x => typeof x === 'string' && /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  class CarrierError extends Error {}
  const check = (ok, message) => { if (!ok) throw new CarrierError(message); };
  const copy = x => JSON.parse(JSON.stringify(x));
  const fields = (x, allowed) => { check(object(x) && Object.keys(x).every(k => allowed.includes(k)), 'Unsupported carrier fields'); };
  const text = (x, max = 1000000) => typeof x === 'string' && x.length <= max;
  const rowKeys = ['sessionId', 'cliSessionId', 'cwd', 'originCwd', 'title', 'model', 'effort', 'createdAt', 'lastActivityAt', 'isArchived', 'isRunning', 'turnRunning', 'hasBackgroundActivity', 'hasBackgroundWork', 'permissionMode', 'pendingToolPermissions', 'pendingRefusalFallbackPrompt', 'errorCategory', 'cliBootPending', 'loadGeneration', 'forkedFromSessionId'];
  const local = row => object(row) && localId(row.sessionId) && !row.remoteTarget && !row.sshConfig && !row.wslConfig && !row.movedToCloud;
  const session = row => row == null ? null : Object.fromEntries(rowKeys.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
  const methods = new Set(['getSessionList', 'getAll', 'getSession', 'start', 'sendMessage', 'send', 'interrupt', 'stop', 'getTranscript', 'getTranscriptTail', 'getTranscriptPage', 'respondToToolPermission', 'setModel', 'setEffort', 'setPermissionMode', 'getDefaultEffort', 'getAdvisorSetting', 'models']);
  function images(xs) {
    if (xs == null) return undefined;
    check(Array.isArray(xs) && xs.length <= 20, 'Invalid images');
    return xs.map(x => {
      fields(x, ['base64', 'mimeType', 'filename']);
      check(text(x.base64, 28000000) && /^[A-Za-z0-9+/]*={0,2}$/.test(x.base64) && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(x.mimeType), 'Invalid image content');
      check(x.filename === undefined || text(x.filename, 512), 'Invalid image filename');
      return copy(x);
    });
  }
  function attachments(xs) {
    if (xs == null) return undefined;
    check(Array.isArray(xs) && xs.length <= 20, 'Invalid attachments');
    return xs.map(x => {
      fields(x, ['name', 'base64']);
      check(text(x.name, 512) && text(x.base64, 28000000) && /^[A-Za-z0-9+/]*={0,2}$/.test(x.base64), 'Invalid attachment content');
      return copy(x);
    });
  }
  function remember(s, req) {
    if (object(req) && localId(req.sessionId) && text(req.requestId, 256) && text(req.toolName, 256)) { s.pending.set(req.requestId, {requestId:req.requestId,sessionId:req.sessionId}); if (s.pending.size > 128) s.pending.delete(s.pending.keys().next().value); }
  }
  async function get(s, id) {
    check(localId(id), 'Expected a native local Code session ID');
    const row = await s.api.getSession(id);
    check(local(row) && row.sessionId === id, 'Local Code session unavailable; no replacement was started');
    // Snapshot is authoritative: stale approvals cannot be answered after a
    // different client answered them, or a turn/process changed.
    for (const [key, req] of s.pending) if (req.sessionId === id) s.pending.delete(key);
    for (const req of row.pendingToolPermissions || []) remember(s, req);
    return row;
  }
  function append(s, channel, event) {
    if (!object(event) || !(localId(event.sessionId) || (channel === 'event' && event.sessionId === '' && event.type === 'initialized'))) return;
    if (channel === 'permission') remember(s, event);
    if (event.request) remember(s, event.request);
    if (event.session && !local(event.session)) return;
    const value = copy(event);
    if (value.session) value.session = session(value.session);
    const bytes = JSON.stringify(value).length;
    const sequence = ++s.next;
    if (bytes > 1000000) { s.floor = sequence; s.events = []; s.bytes = 0; return; }
    s.events.push({sequence, channel, event: value, bytes}); s.bytes += bytes;
    while (s.events.length > 1024 || s.bytes > 4000000) {
      const old = s.events.shift(); s.bytes -= old.bytes; s.floor = old.sequence;
    }
  }
  function reap() {
    for (const [id, s] of states) if (Date.now() - s.touched > 300000) {
      for (const stop of s.unsubscribe) { try { stop(); } catch {} }
      states.delete(id);
    }
  }
  async function invoke(s, name, args) {
    check(methods.has(name) && Array.isArray(args) && args.length <= 15, 'Unsupported Desktop method');
    check(JSON.stringify(args).length <= 32000000, 'Carrier request exceeds limit');
    const api = s.api;
    if (['getSessionList', 'getAll', 'models'].includes(name)) {
      check(args.length === 0, 'Unexpected arguments');
      const result = await api.getSessionList();
      check(object(result) && Array.isArray(result.sessions), 'Invalid native session list');
      const rows = result.sessions.filter(local);
      for (const row of rows) for (const req of row.pendingToolPermissions || []) remember(s, req);
      if (name === 'models') return {data: [...new Set(rows.map(r => r.model).filter(x => text(x, 256) && x))].map(model => ({id: model, model, displayName: model, supportedReasoningEfforts: [], serviceTiers: []})), catalogComplete: false};
      return name === 'getAll' ? rows.map(session) : {sessions: rows.map(session), loadGeneration: result.loadGeneration, archivedPending: result.archivedPending};
    }
    if (name === 'start') {
      check(args.length === 1, 'Expected start info');
      const info = args[0];
      fields(info, ['cwd', 'message', 'sessionId', 'title', 'model', 'permissionMode', 'useWorktree', 'images', 'attachments', 'withoutFirstMessage']);
      check(text(info.cwd, 4096) && info.cwd.startsWith('/') && !info.cwd.includes('\0') && text(info.message), 'Invalid local Code start');
      check(info.sessionId === undefined || localId(info.sessionId), 'Invalid new session identity');
      if (info.sessionId) check(await api.getSession(info.sessionId) == null, 'Session already exists; use send');
      check(info.model === undefined || text(info.model, 256), 'Invalid model');
      check(info.title === undefined || text(info.title, 512), 'Invalid title');
      check(info.permissionMode === undefined || ['default', 'plan', 'acceptEdits'].includes(info.permissionMode), 'Permission mode was not offered');
      check(info.withoutFirstMessage === undefined || info.withoutFirstMessage === true, 'Invalid first message option');
      check(info.useWorktree === undefined || typeof info.useWorktree === 'boolean', 'Invalid worktree option');
      return api.start({...info, images: images(info.images), attachments: attachments(info.attachments)});
    }
    if (name === 'respondToToolPermission') {
      check(args.length >= 2 && args.length <= 3 && text(args[0], 256) && ['once', 'deny'].includes(args[1]), 'Permission decision was not offered');
      const prior = s.pending.get(args[0]); check(prior, 'Permission request is not pending');
      const refreshed = await get(s, prior.sessionId);
      const req = (refreshed.pendingToolPermissions || []).find(x => x.requestId === args[0]); check(req, 'Native permission changed; refresh before answering');
      let updated;
      if (req.toolName === 'AskUserQuestion' && args[1] === 'once') {
        fields(args[2], ['answers']);
        check(object(args[2].answers) && Array.isArray(req.input?.questions), 'Invalid question response');
        const expected = req.input.questions.map(q => q.question);
        check(Object.keys(args[2].answers).length === expected.length && expected.every(k => Object.hasOwn(args[2].answers, k) && text(args[2].answers[k], 10000)), 'Answer the original questions only');
        updated = {...copy(req.input), answers: copy(args[2].answers)};
      } else check(args[2] == null, 'Arbitrary permission input updates are not supported');
      await api.respondToToolPermission(args[0], args[1], updated);
      s.pending.delete(args[0]); return null;
    }
    if (name === 'getDefaultEffort') { check(args.length === 0, 'Unexpected arguments'); return api.getDefaultEffort(); }
    if (name === 'send') {
      check(args.length === 1, 'Expected send request');
      const p = args[0]; fields(p, ['sessionId', 'message', 'images', 'attachments', 'messageUuid']);
      return invoke(s, 'sendMessage', [p.sessionId, p.message, p.images ?? null, null, p.attachments ?? null, null, null, p.messageUuid ?? null]);
    }
    const row = await get(s, args[0]);
    if (name === 'getSession') { check(args.length === 1, 'Unexpected arguments'); return session(row); }
    if (name === 'getTranscript') { check(args.length === 1, 'Unexpected arguments'); return api.getTranscript(args[0]); }
    if (name === 'getTranscriptTail' || name === 'getTranscriptPage') {
      const page = name === 'getTranscriptPage';
      check(args.length >= (page ? 3 : 2) && args.length <= (page ? 4 : 2), 'Invalid transcript arguments');
      const limit = args[page ? 2 : 1]; check(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'Invalid history page limit');
      if (page) {
        check(text(args[1], 256), 'Invalid history cursor');
        const options = args[3] ?? {};
        fields(options, ['window', 'fileCursor']);
        check((options.window === undefined || text(options.window, 256)) && (options.fileCursor === undefined || text(options.fileCursor, 40)), 'Invalid native page options');
        return api.getTranscriptPage(args[0], args[1], limit, options);
      }
      return api.getTranscriptTail(args[0], limit);
    }
    if (name === 'sendMessage') {
      check(args.length >= 2 && text(args[1]), 'Invalid Code message');
      // No synthetic origins, permission modes, arbitrary tool state, pane
      // holds, model-authored marks or queued input manipulation from clients.
      for (const i of [3, 5, 6, 8, 9, 10, 11, 12, 13, 14]) check(args[i] == null, 'Unsupported send option');
      check(args[7] == null || /^[0-9a-f-]{36}$/i.test(args[7]), 'Invalid message identity');
      return api.sendMessage(args[0], args[1], images(args[2]), undefined, attachments(args[4]), undefined, undefined, args[7] ?? undefined);
    }
    if (['interrupt', 'stop', 'getAdvisorSetting'].includes(name)) { check(args.length === 1, 'Unexpected arguments'); return api[name](args[0]); }
    if (['setModel', 'setEffort', 'setPermissionMode'].includes(name)) {
      check(args.length === 2, 'Invalid settings arguments');
      check(!row.isRunning && !row.turnRunning && !(row.pendingToolPermissions || []).length, 'Native session is busy');
      if (name === 'setModel') check(text(args[1], 256) && args[1].length > 0, 'Invalid model');
      if (name === 'setEffort') check(args[1] == null || ['low', 'medium', 'high', 'max', 'xhigh'].includes(args[1]), 'Invalid effort');
      if (name === 'setPermissionMode') check(['default', 'plan', 'acceptEdits'].includes(args[1]), 'Permission mode was not offered');
      return api[name](args[0], args[1]);
    }
    throw new CarrierError('Unsupported Desktop method');
  }
  return async command => {
    try {
      check(object(command) && typeof command.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(command.id), 'Invalid carrier identity');
      reap();
      if (command.op === 'open') {
        check(!states.has(command.id), 'Carrier already exists');
        const api = globalThis['claude.web']?.LocalSessions;
        check(api && ['getSession', 'getSessionList', 'start', 'sendMessage', 'respondToToolPermission', 'getTranscriptTail', 'getTranscriptPage', 'interrupt', 'setModel', 'onOnEvent', 'onOnToolPermissionRequest'].every(k => typeof api[k] === 'function'), 'Claude Code preload unavailable');
        const s = {api, touched: Date.now(), next: 0, floor: 0, bytes: 0, events: [], pending: new Map(), unsubscribe: []};
        states.set(command.id, s);
        try {
          s.unsubscribe.push(api.onOnEvent(e => append(s, 'event', e)));
          s.unsubscribe.push(api.onOnToolPermissionRequest(e => append(s, 'permission', e)));
          check(s.unsubscribe.every(x => typeof x === 'function'), 'Preload event subscription failed');
        } catch { for (const stop of s.unsubscribe) { try { stop(); } catch {} } states.delete(command.id); throw new CarrierError('Preload event subscription failed'); }
        return {ok: true, value: {version: 1, generation: command.id, methods: [...methods]}};
      }
      const s = states.get(command.id); check(s, 'Carrier expired or renderer navigated; reconnect explicitly'); s.touched = Date.now();
      if (command.op === 'close') {
        for (const stop of s.unsubscribe) { try { stop(); } catch {} }
        states.delete(command.id); return {ok: true, value: null};
      }
      if (command.op === 'poll') {
        const cursor = command.cursor;
        check(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= s.next, 'Invalid event cursor');
        let bytes = 0;
        const events = [];
        for (const e of s.events) if (e.sequence > cursor) { if (events.length >= 128 || (events.length && bytes + e.bytes > 1000000)) break; bytes += e.bytes; events.push({sequence: e.sequence, channel: e.channel, event: e.event}); }
        return {ok: true, value: {events, cursor: events.length ? events[events.length - 1].sequence : s.next, gap: cursor < s.floor, generation: command.id}};
      }
      check(command.op === 'invoke', 'Unsupported carrier operation');
      const value = await invoke(s, command.method, command.args);
      return {ok: true, value: value === undefined ? null : value};
    } catch (error) {
      // Native errors may contain prompts, paths, or account details. Preserve
      // only our own fixed diagnostics; never serialize native stacks/objects.
      const own = error instanceof CarrierError;
      return {ok: false, error: own ? error.message : 'Native Desktop call failed; delivery outcome may be unknown; do not replay automatically'};
    }
  };
})()
