/* global window, localStorage */
'use strict';

/**
 * 브라우저 단독 실행용 백엔드.
 *
 * `api.js`(서버 호출)와 **완전히 같은 인터페이스**를 제공한다. 그래서
 * 화면 코드(app.js · canvas.js · report.js · charts.js)는 서버가 있든 없든
 * 한 줄도 달라지지 않는다. 도면 생성 로직도 서버와 동일한 모듈을 그대로 쓴다.
 *
 *   저장소  : localStorage (브라우저별로 유지)
 *   계측값  : 메모리 + localStorage. 실제 운영에서는 POST /api/ingest 가 채운다.
 */
window.ScadaLocalApi = (function (req) {
  const importer = req('importer');
  const diagramMod = req('diagram');
  const schemaMod = req('schema');
  const codes = req('codes');

  const KEY_PROJECTS = 'fems.scada.projects.v1';
  const KEY_READINGS = 'fems.scada.readings.v1';

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 용량 초과 등 — 화면은 계속 동작해야 하므로 조용히 넘긴다
      console.warn('[scada] 로컬 저장 실패:', e && e.message);
      return false;
    }
  }

  let projects = load(KEY_PROJECTS, []);
  let readings = load(KEY_READINGS, {});
  let nextId = projects.reduce((m, p) => Math.max(m, p.id), 0) + 1;

  const persist = () => save(KEY_PROJECTS, projects);
  const stripLookup = (model) => {
    const copy = Object.assign({}, model);
    delete copy.__lookup;
    return copy;
  };
  const find = (id) => projects.filter((p) => p.id === Number(id))[0] || null;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  async function runImport(file, opts) {
    const buffer = await file.arrayBuffer();
    return importer.importWorkbook(buffer, {
      filename: file.name,
      tolerant: !!(opts && (opts.tolerant === true || opts.tolerant === 'true')),
      name: opts && opts.name,
    });
  }

  return {
    /** 서버 없이 동작 중임을 화면이 알 수 있게 하는 표식 */
    standalone: true,

    async schema() {
      return {
        sheets: schemaMod.SHEETS,
        requiredSheets: schemaMod.REQUIRED_SHEETS,
        basicFields: schemaMod.BASIC_FIELDS.map((f) => ({ cell: f.cell, label: f.label, required: !!f.required })),
        deviceColumns: schemaMod.DEVICE_SHEET.columns,
        channelColumns: schemaMod.CHANNEL_SHEET.columns,
        energyTreeColumns: schemaMod.ENERGY_TREE_SHEET.columns,
        deviceProfileColumns: schemaMod.DEVICE_PROFILE_SHEET.columns,
        codeTables: {
          equipment: codes.EQUIPMENT_CODES,
          energySources: codes.ENERGY_SOURCE_CODES,
          tariffs: codes.TARIFFS,
          measureTypes: codes.MEASURE_TYPES,
          statTypes: codes.STAT_TYPES,
          pointRoles: codes.POINT_ROLES,
        },
      };
    },

    async preview(file, opts) {
      const r = await runImport(file, opts);
      return {
        ok: r.ok,
        stage: r.stage,
        filename: file.name,
        sheetNames: r.sheetNames || [],
        report: r.report,
        diagram: r.diagram || null,
        model: r.model ? stripLookup(r.model) : null,
      };
    },

    async import(file, opts) {
      const r = await runImport(file, opts);
      if (!r.diagram) {
        return {
          ok: false,
          report: r.report,
          message: '엑셀에 오류가 있어 도면을 만들 수 없습니다. 아래 항목을 수정한 뒤 다시 업로드하세요.',
        };
      }
      const model = stripLookup(r.model);
      const now = new Date().toISOString();
      const project = {
        id: nextId++,
        name: (opts && opts.name) || r.diagram.meta.name,
        factoryCode: model.site.factoryCode || null,
        company: model.site.company || null,
        site: model.site.factoryCode || null,
        sourceFilename: file.name,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        model,
        diagram: r.diagram,
        report: r.report,
      };
      projects.unshift(project);
      persist();
      return { ok: r.ok, project: clone(project), report: r.report };
    },

    async listProjects() {
      return {
        projects: projects
          .slice()
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          .map((p) => ({
            id: p.id, name: p.name, factoryCode: p.factoryCode, company: p.company,
            site: p.site, sourceFilename: p.sourceFilename, publishedAt: p.publishedAt,
            createdAt: p.createdAt, updatedAt: p.updatedAt,
          })),
      };
    },

    async getProject(id) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      return clone(p);
    },

    async saveDiagram(id, diagram, name) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      p.diagram = clone(diagram);
      if (name) p.name = name;
      p.updatedAt = new Date().toISOString();
      const stored = persist();
      return { ok: true, stored, project: { id: p.id, name: p.name, updatedAt: p.updatedAt } };
    },

    async deleteProject(id) {
      projects = projects.filter((p) => p.id !== Number(id));
      persist();
      return { ok: true };
    },

    async addMain(id, payload) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      const node = diagramMod.addMain(p.diagram, payload || {});
      p.updatedAt = new Date().toISOString();
      persist();
      return { ok: true, node: clone(node), mains: p.diagram.nodes.filter((n) => n.kind === 'main').length };
    },

    /**
     * 서버에서는 FEMS points 테이블에 등록하는 단계.
     * 단독 실행에서는 등록 대상 포인트를 확정해 두는 것까지만 한다.
     */
    async publish(id, site) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      const points = diagramMod.collectPoints(p.diagram);
      p.publishedAt = new Date().toISOString();
      persist();
      return {
        ok: true,
        projectId: p.id,
        site: site || p.site || p.factoryCode || 'FEMS',
        count: points.length,
        points: points.map((x) => x.key),
      };
    },

    async live(id) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      const keys = diagramMod.collectPoints(p.diagram).map((x) => x.key);
      const values = {};
      let liveCount = 0;
      for (const k of keys) {
        if (readings[k]) {
          values[k] = readings[k];
          liveCount++;
        }
      }
      return { ts: new Date().toISOString(), values, bound: keys.length, live: liveCount };
    },

    async points(id) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      return { points: diagramMod.collectPoints(p.diagram) };
    },

    async demoTick(id) {
      const p = find(id);
      if (!p) throw new Error('도면을 찾을 수 없습니다.');
      const nodeById = new Map(p.diagram.nodes.map((n) => [n.id, n]));
      const t = Date.now() / 60000;
      const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
      let n = 0;

      for (const pt of diagramMod.collectPoints(p.diagram)) {
        const node = nodeById.get(pt.nodeId);
        const base = node && node.kind === 'main' ? Number(p.model.site.contractPower) || 800 : 45;
        const wave = 0.75 + 0.25 * Math.sin(t + (pt.deviceId || 1) * 0.7 + (pt.channel || 1) * 0.3);
        const byRole = {
          power: base * wave,
          usage: base * wave * 0.25,
          current: base * wave * 1.4,
          voltage: 380 + Math.sin(t) * 3,
          pf: 92 + Math.sin(t * 0.6) * 5,
          reactive: base * wave * 0.3,
          energy: base * wave * 0.25,
          runtime: 1200 + (t % 100),
        };
        const value = byRole[pt.role] != null ? byRole[pt.role] : base * wave;
        readings[pt.key] = { value: Number(value.toFixed(2)), ts };
        n++;
      }
      save(KEY_READINGS, readings);
      return { ok: true, injected: n, note: '데모 값입니다. 운영에서는 POST /api/ingest 로 실계측값을 보냅니다.' };
    },

    /** 외부(수집 프로그램 대신) 값 주입 — 단독 실행에서 실계측값을 넣어 볼 때 사용 */
    ingest(list) {
      const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
      let n = 0;
      for (const r of list || []) {
        if (!r || !r.point_key) continue;
        readings[r.point_key] = { value: Number(r.value), ts: r.ts || ts };
        n++;
      }
      save(KEY_READINGS, readings);
      return n;
    },

    resetAll() {
      projects = [];
      readings = {};
      localStorage.removeItem(KEY_PROJECTS);
      localStorage.removeItem(KEY_READINGS);
    },
  };
});
