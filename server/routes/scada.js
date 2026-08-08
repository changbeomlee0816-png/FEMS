'use strict';

const express = require('express');
const multer = require('multer');

const { importWorkbook } = require('../scada/importer');
const store = require('../scada/store');
const { addMain, collectPoints } = require('../scada/diagram');
const femsStore = require('../store');
const codes = require('../scada/codes');
const schema = require('../scada/schema');
const template = require('../scada/template');
const vision = require('../../public/js/scada/vision');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xlsm)$/i.test(file.originalname)) return cb(null, true);
    cb(Object.assign(new Error('XLSX_ONLY'), { code: 'XLSX_ONLY' }));
  },
});

/**
 * 양식 다운로드 — 기입 예시가 들어간 양식(기본) 또는 빈 양식.
 * 스키마·코드표에서 즉석 생성하므로 검증기와 절대 어긋나지 않는다.
 */
router.get('/template', async (req, res, next) => {
  try {
    const mode = req.query.mode === 'blank' ? 'blank' : 'example';
    const buf = await template.templateBuffer({ mode });
    const name = mode === 'blank' ? 'FEMS_수용가등록_양식.xlsx' : 'FEMS_수용가등록_양식_예시.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    next(e);
  }
});

/** 양식 스키마 (프런트엔드 "양식 안내" 화면용) */
router.get('/schema', (req, res) => {
  res.json({
    sheets: schema.SHEETS,
    requiredSheets: schema.REQUIRED_SHEETS,
    basicFields: schema.BASIC_FIELDS.map((f) => ({ cell: f.cell, label: f.label, required: !!f.required })),
    deviceColumns: schema.DEVICE_SHEET.columns,
    channelColumns: schema.CHANNEL_SHEET.columns,
    energyTreeColumns: schema.ENERGY_TREE_SHEET.columns,
    deviceProfileColumns: schema.DEVICE_PROFILE_SHEET.columns,
    codeTables: {
      equipment: codes.EQUIPMENT_CODES,
      energySources: codes.ENERGY_SOURCE_CODES,
      tariffs: codes.TARIFFS,
      measureTypes: codes.MEASURE_TYPES,
      statTypes: codes.STAT_TYPES,
      pointRoles: codes.POINT_ROLES,
    },
  });
});

/**
 * 엑셀 업로드 → 검증 → 도면 생성 (저장하지 않고 미리보기만)
 * body: file(multipart), tolerant=true|false
 */
router.post('/import/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '업로드된 파일이 없습니다. (필드명: file)' });
    const result = await importWorkbook(req.file.buffer, {
      filename: req.file.originalname,
      tolerant: req.body.tolerant === 'true',
      name: req.body.name,
    });
    res.json({
      ok: result.ok,
      stage: result.stage,
      filename: req.file.originalname,
      sheetNames: result.sheetNames || [],
      report: result.report,
      diagram: result.diagram || null,
      model: result.model ? store.serializableModel(result.model) : null,
    });
  } catch (e) {
    next(e);
  }
});

/** 엑셀 업로드 → 검증 통과 시 프로젝트로 저장 */
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '업로드된 파일이 없습니다. (필드명: file)' });
    const tolerant = req.body.tolerant === 'true';
    const result = await importWorkbook(req.file.buffer, {
      filename: req.file.originalname,
      tolerant,
      name: req.body.name,
    });

    if (!result.diagram) {
      return res.status(422).json({
        ok: false,
        stage: result.stage,
        filename: req.file.originalname,
        report: result.report,
        message: '엑셀에 오류가 있어 도면을 만들 수 없습니다. 아래 항목을 수정한 뒤 다시 업로드하세요.',
      });
    }

    const project = store.create({
      name: req.body.name || result.diagram.meta.name,
      model: result.model,
      diagram: result.diagram,
      report: result.report,
      sourceFilename: req.file.originalname,
      site: req.body.site,
    });

    res.status(201).json({ ok: result.ok, project, report: result.report });
  } catch (e) {
    next(e);
  }
});

// ── 전력계통도 사진 AI 판독 ────────────────────────────────────────
/**
 * 서버가 판독을 대신해 줄 수 있는지 알려 준다.
 *
 * 서버에 키(ANTHROPIC_API_KEY)가 있으면 화면은 아무것도 묻지 않고 바로 판독한다.
 * 없으면 화면이 사용자 키를 받아 브라우저에서 직접 부른다 (정적 배포판과 같은 길).
 */
router.get('/ai', (req, res) => {
  res.json({ ai: !!process.env.ANTHROPIC_API_KEY, model: vision.MODEL });
});

/**
 * 도면 그림 → 계통 JSON.
 * body: { images:[{dataUrl}], textDump, filename }
 *
 * 이미지가 base64 로 들어오므로 이 경로만 본문 한도를 크게 잡는다.
 */
router.post('/analyze', express.json({ limit: '24mb' }), async (req, res, next) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: '서버에 ANTHROPIC_API_KEY 가 없어 AI 판독을 할 수 없습니다.',
      needKey: true,
    });
  }

  const { images, textDump, filename } = req.body || {};
  if ((!Array.isArray(images) || !images.length) && !textDump) {
    return res.status(400).json({ error: '판독할 도면 그림이 없습니다.' });
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    return res.status(503).json({
      error: 'AI 판독 모듈이 설치되어 있지 않습니다. `npm install @anthropic-ai/sdk` 후 다시 시도하세요.',
    });
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const request = vision.buildRequest({ images, textDump, filename });
    let message;
    try {
      message = await client.messages.create(request);
    } catch (e) {
      // 구조화 출력을 못 받는 조합이면 스키마 없이 한 번 더 — 프롬프트만으로도 JSON 이 나온다
      if (e && e.status === 400 && /output_config|json_schema/i.test(String(e.message))) {
        const relaxed = Object.assign({}, request);
        delete relaxed.output_config;
        message = await client.messages.create(relaxed);
      } else {
        throw e;
      }
    }
    res.json({ ok: true, analysis: vision.normalize(vision.parseResponse(message)) });
  } catch (e) {
    if (e && e.status === 401) return res.status(502).json({ error: '서버의 API 키가 올바르지 않습니다.' });
    if (e && e.status === 429) return res.status(429).json({ error: '요청이 몰렸습니다. 잠시 뒤 다시 시도해 주세요.' });
    console.error('[scada/analyze]', e);
    res.status(502).json({ error: `도면 판독에 실패했습니다: ${String((e && e.message) || e)}` });
  }
});

/**
 * 엑셀 없이 새 도면 시작.
 * 업로드 경로와 같은 모델 모양을 만들어 같은 저장소에 넣는다.
 */
router.post('/projects/blank', (req, res, next) => {
  try {
    const { blankProject } = require('../scada/blank');
    const built = blankProject(req.body || {});
    const project = store.create({
      name: req.body.name || built.diagram.meta.name,
      model: built.model,
      diagram: built.diagram,
      report: { issues: [], errorCount: 0, warningCount: 0, infoCount: 0, summary: {} },
      sourceFilename: null,
      site: req.body.site,
    });
    res.status(201).json({ ok: true, project });
  } catch (e) {
    next(e);
  }
});

// ── 프로젝트 CRUD ──────────────────────────────────────────────────
router.get('/projects', (req, res) => {
  res.json({ projects: store.list(Number(req.query.limit) || 50) });
});

router.get('/projects/:id', (req, res) => {
  const p = store.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
  res.json(p);
});

router.put('/projects/:id/diagram', (req, res) => {
  const { diagram, name } = req.body || {};
  if (!diagram || !Array.isArray(diagram.nodes)) {
    return res.status(400).json({ error: 'diagram.nodes 가 필요합니다.' });
  }
  const p = store.saveDiagram(Number(req.params.id), diagram, name);
  if (!p) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
  res.json({ ok: true, project: { id: p.id, name: p.name, updatedAt: p.updatedAt } });
});

router.delete('/projects/:id', (req, res) => {
  const ok = store.remove(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

/**
 * 한전 메인 추가.
 * 한 업체에 한전 수전점이 둘 이상인 경우를 도면에서 직접 늘린다.
 */
router.post('/projects/:id/mains', (req, res) => {
  const p = store.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });

  const node = addMain(p.diagram, req.body || {});
  store.saveDiagram(p.id, p.diagram);
  res.status(201).json({ ok: true, node, mains: p.diagram.nodes.filter((n) => n.kind === 'main').length });
});

/** 도면 계측 포인트 → FEMS points 등록 (본 시스템 연동) */
router.post('/projects/:id/publish', (req, res) => {
  const result = store.publish(Number(req.params.id), { site: req.body && req.body.site });
  if (!result) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
  res.json({ ok: true, ...result });
});

/** 도면에 표시할 실시간 값 */
router.get('/projects/:id/live', (req, res) => {
  const live = store.liveValues(Number(req.params.id));
  if (!live) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
  res.json(live);
});

/** 계측 포인트 목록 (연동 규격 확인용) */
router.get('/projects/:id/points', (req, res) => {
  const p = store.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
  res.json({ points: collectPoints(p.diagram) });
});

/**
 * 데모 주입: 실제 계측기 연동 전에 화면이 살아있는지 확인하기 위한 값 생성.
 * 운영에서는 외부 수집 프로그램이 POST /api/ingest 로 같은 point_key 를 보낸다.
 */
router.post('/projects/:id/demo-tick', (req, res) => {
  const p = store.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: '도면을 찾을 수 없습니다.' });

  const site = p.site || p.factoryCode || 'FEMS';
  const nodeById = new Map(p.diagram.nodes.map((n) => [n.id, n]));
  const t = Date.now() / 60000;
  let n = 0;

  for (const pt of collectPoints(p.diagram)) {
    const node = nodeById.get(pt.nodeId);
    // 노드에 정격이 있으면 그 값을 기준으로 만든다. 없을 때만 계약전력/기본값으로 떨어진다.
        // (이렇게 해야 계약전력 대비 사용률이 현실적인 범위로 나온다)
        const rated = node && Number(node.ratedPower) > 0 ? Number(node.ratedPower) : null;
        // 데모에서는 일부 설비를 일부러 과부하로 만든다. 알람 바가 비어 있으면
        // 관제화면의 핵심 기능을 보여주지 못하기 때문이다. (규칙은 결정적)
        const hot = node && node.kind === 'load' && (node.systemId || 0) % 4 === 0 ? 1.9 : 1;
        const base = (rated ? rated * 0.72 : node && node.kind === 'main' ? Number(p.model.site.contractPower) || 800 : 45) * hot;
    const wave = 0.75 + 0.25 * Math.sin(t + (pt.deviceId || 1) * 0.7 + (pt.channel || 1) * 0.3);
    // 전압은 그 계통의 실제 전압에서 만들고, 전류는 P = √3·V·I·cosφ 로 역산한다.
    const volt = node && node.voltage != null ? node.voltage * 1000 : 380;
    const pfPct = 92 + Math.sin(t * 0.6) * 5; // 역률은 % 단위 (배율 100 적용 후 값)
    const byRole = {
      power: base * wave,
      usage: base * wave * 0.25,
      current: (base * wave * 1000) / (volt * 1.732 * (pfPct / 100)),
      voltage: volt * (1 + Math.sin(t) * 0.008),
      pf: pfPct,
      reactive: base * wave * 0.3,
      energy: base * wave * 0.25,
      runtime: 1200 + (t % 100),
    };
    const value = byRole[pt.role] != null ? byRole[pt.role] : base * wave;
    femsStore.ingestReading({
      point_key: pt.key,
      site,
      name: `${pt.nodeName} · ${pt.name}`,
      unit: pt.unit,
      value: Number(value.toFixed(2)),
      effective_power: pt.role === 'power' ? Number(value.toFixed(2)) : null,
    });
    n++;
  }
  res.json({ ok: true, injected: n, note: '데모 값입니다. 운영에서는 POST /api/ingest 로 실계측값을 보냅니다.' });
});

// ── 오류 처리 ──────────────────────────────────────────────────────
router.use((err, req, res, _next) => {
  if (err && err.code === 'XLSX_ONLY') {
    return res.status(400).json({ error: '.xlsx 파일만 업로드할 수 있습니다. (.xls / .csv 는 지원하지 않습니다)' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '파일이 너무 큽니다. (최대 20MB)' });
  }
  console.error('[scada]', err);
  res.status(500).json({ error: '도면 처리 중 오류가 발생했습니다.', detail: String(err && err.message) });
});

module.exports = router;
