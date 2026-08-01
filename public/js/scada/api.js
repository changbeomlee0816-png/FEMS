/* global window */
'use strict';

/**
 * SCADA 도면 API 클라이언트.
 *
 * 서버 엔드포인트를 한 곳에 모아둔다. 나중에 FEMS 본 시스템에 이 화면을
 * 이식할 때 여기 base 만 바꾸면 된다.
 */
window.ScadaApi = (function () {
  const base = '/api/scada';

  async function json(res) {
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error(`서버 응답을 해석할 수 없습니다 (HTTP ${res.status})`);
    }
    if (!res.ok && res.status !== 422) {
      throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
    }
    return body;
  }

  function upload(path, file, fields) {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields || {})) if (v != null) fd.append(k, String(v));
    return fetch(base + path, { method: 'POST', body: fd }).then(json);
  }

  function send(method, path, body) {
    return fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(json);
  }

  return {
    schema: () => send('GET', '/schema'),
    template: async (mode) => {
      const res = await fetch(`${base}/template?mode=${mode === 'blank' ? 'blank' : 'example'}`);
      if (!res.ok) throw new Error('양식을 받지 못했습니다.');
      return new Uint8Array(await res.arrayBuffer());
    },
    preview: (file, opts) => upload('/import/preview', file, opts),
    import: (file, opts) => upload('/import', file, opts),

    createBlank: (payload) => send('POST', '/projects/blank', payload || {}),
    listProjects: () => send('GET', '/projects'),
    getProject: (id) => send('GET', `/projects/${id}`),
    saveDiagram: (id, diagram, name) => send('PUT', `/projects/${id}/diagram`, { diagram, name }),
    deleteProject: (id) => send('DELETE', `/projects/${id}`),

    addMain: (id, payload) => send('POST', `/projects/${id}/mains`, payload || {}),
    publish: (id, site) => send('POST', `/projects/${id}/publish`, { site }),
    live: (id) => send('GET', `/projects/${id}/live`),
    points: (id) => send('GET', `/projects/${id}/points`),
    demoTick: (id) => send('POST', `/projects/${id}/demo-tick`, {}),
  };
})();
