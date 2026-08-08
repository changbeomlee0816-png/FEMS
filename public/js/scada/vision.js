/* global window, module, fetch, localStorage, Image, document */
'use strict';

/**
 * 전력계통도 사진 → SCADA 계통 (AI 판독).
 *
 * 사진·스캔 도면은 글자를 꺼낼 수 없어서 규칙 기반으로는 읽히지 않는다.
 * 그래서 도면 그림 자체를 **Claude 에게 보여 주고 계통을 읽게** 한다.
 * 결과는 노드/부모 관계로 된 JSON 이고, 그대로 도면 노드로 세워진다.
 *
 * 이 파일 하나가 서버와 브라우저 양쪽에서 쓰인다.
 *   - 서버판   : server/routes/scada.js 가 require 해서 프롬프트·스키마·정규화를 쓴다
 *                (API 키는 서버 환경변수 ANTHROPIC_API_KEY 에 둔다)
 *   - 단독판   : 브라우저가 사용자가 넣은 키로 api.anthropic.com 을 직접 부른다
 *                (GitHub Pages 처럼 서버가 없는 곳)
 *
 * 어느 쪽이든 **프롬프트와 정규화 로직은 같은 코드**다. 판독 결과가 갈리지 않는다.
 */
(function (factory) {
  const core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof window !== 'undefined') window.ScadaVision = core;
})(function () {
  const MODEL = 'claude-opus-5';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';
  const KEY_STORE = 'fems.scada.anthropic-key';

  /** 도면에 놓을 수 있는 기호 — public/js/scada/symbols.js 의 CATALOG 와 같은 목록 */
  const SYMBOL_IDS = [
    'utility', 'generator', 'pv', 'wind', 'ess', 'ups', 'fuelcell', 'pcs', 'rectifier',
    'transformer', 'transformer3', 'autotransformer', 'pt', 'ct', 'zct', 'mof', 'reactor', 'capacitor', 'ngr',
    'breaker', 'vcb', 'acb', 'gcb', 'mccb', 'elcb', 'switch', 'lbs', 'es', 'cos', 'fuse', 'ats', 'contactor',
    'relay', 'meter', 'ammeter', 'voltmeter', 'la', 'sa', 'spd', 'eld', 'ch',
    'motor', 'vfd', 'pump', 'fan', 'compressor', 'chiller', 'ahu', 'heat', 'furnace', 'machine',
    'lighting', 'heater', 'evcharger', 'load',
    'switchgear', 'panel', 'busbar', 'ground', 'cable',
  ];

  /** 도면에서 흔히 쓰는 약어 → 기호 id (모델이 엉뚱한 이름을 주더라도 살려낸다) */
  const ALIASES = {
    kepco: 'utility', incoming: 'utility', incomer: 'utility', source: 'utility', 수전점: 'utility',
    gen: 'generator', eng: 'generator', dg: 'generator', 발전기: 'generator',
    solar: 'pv', 태양광: 'pv', inverter: 'pcs', battery: 'ess',
    tr: 'transformer', trf: 'transformer', xfmr: 'transformer', 변압기: 'transformer',
    tr3: 'transformer3', atr: 'autotransformer',
    cb: 'breaker', 'v.c.b': 'vcb', 'a.c.b': 'acb', abb: 'acb', ocb: 'breaker', obs: 'lbs',
    mcb: 'mccb', nfb: 'mccb', elb: 'elcb', rcd: 'elcb',
    ds: 'switch', lds: 'lbs', asx: 'lbs', 단로기: 'switch',
    pf: 'fuse', 'p.f': 'fuse', ph: 'fuse', 전력퓨즈: 'fuse',
    mc: 'contactor', mg: 'contactor', ocr: 'relay', ogr: 'relay', 'gr': 'relay',
    sc: 'capacitor', cap: 'capacitor', sr: 'reactor', l: 'reactor',
    wh: 'meter', kwh: 'meter', 'w.h': 'meter',
    mcc: 'panel', lp: 'panel', pp: 'panel', pnl: 'panel', 분전반: 'panel',
    swgr: 'switchgear', 수배전반: 'switchgear', bus: 'busbar', 모선: 'busbar',
    m: 'motor', mtr: 'motor', vvvf: 'vfd', invtr: 'vfd',
    ltg: 'lighting', light: 'lighting', 전등: 'lighting',
    spare: 'load', 예비: 'load', feeder: 'load', 부하: 'load',
    gnd: 'ground', earth: 'ground', e: 'ground',
  };

  // ── 프롬프트 ─────────────────────────────────────────────────────
  const SYSTEM_PROMPT = [
    '당신은 한국 수변전 설비의 단선결선도(전력계통도)를 읽는 전기 설계 기술자입니다.',
    '주어진 도면 이미지를 판독해 계통 구조를 JSON 으로 정확히 옮기는 것이 임무입니다.',
    '',
    '## 판독 원칙',
    '1. 단선결선도는 **위에서 아래로 전력이 흐릅니다.** 맨 위가 한전 수전점(또는 발전기·PV 같은 전원)이고,',
    '   아래로 갈수록 부하 쪽입니다. 부모(parent)는 항상 **전원 쪽에 더 가까운** 기기입니다.',
    '2. 세로선(모선·인출선)을 따라가며 어느 기기가 어느 선에 물려 있는지 봅니다.',
    '   가로 모선(bus)에 여러 인출회로가 매달린 구조라면, 모선을 노드로 만들고 인출회로를 그 자식으로 둡니다.',
    '3. 기기 옆에 적힌 글자를 그대로 읽어 정격을 채웁니다. 한국 도면의 관용 표기:',
    '   - `22.9kV-Y`, `25.8kV` → 전압(kV)',
    '   - `600AF/400AT`, `225/200` → 앞이 프레임(AF), 뒤가 트립(AT, = 정격전류)',
    '   - `12.5kA`, `25kA` → 차단용량',
    '   - `500kVA`, `1000kVA` → 변압기 용량',
    '   - `Δ-Y`, `Dyn11`, `△-Y(중성점접지)` → 변압기 결선(vectorGroup)',
    '   - `22.9kV/380-220V` → 1차/2차 전압. 1차는 voltage, 2차는 secondaryVoltage(kV, 380V 는 0.38)',
    '   - `40/5A`, `200/5A` → CT비 (ctRatio 에 문자열로)',
    '   - `50/51`, `51N`, `87T`, `27`, `59`, `64`, `67` → ANSI 보호계전요소 → protection 배열',
    '   - `CN-CV 60SQ×3`, `F-CV 325SQ` → 케이블 규격 → cable',
    '4. 약어 판독: VCB(진공차단기) ACB(기중차단기) GCB(가스차단기) MCCB(배선용차단기) ELCB/ELB(누전차단기)',
    '   LBS/LDS(부하개폐기) DS(단로기) ES(접지개폐기) COS(컷아웃) PF(전력퓨즈) MOF(계기용변성기)',
    '   PT/VT(계기용변압기) CT(변류기) ZCT(영상변류기) LA(피뢰기) SA(서지흡수기) SPD(서지보호기)',
    '   SC(진상콘덴서) SR(직렬리액터) NGR(중성점접지저항) ATS(자동절체) MC(전자접촉기) ELD(누전경보기)',
    '   CH(케이블헤드) MCC(전동기제어반) LP/PP(분전반) TR(변압기) G(발전기) M(전동기) WH(전력량계)',
    '5. **모선 연락(TIE)** — 두 수전 계통 사이를 잇는 차단기(TIE, BUS TIE, 연락용)는 노드가 아니라',
    '   ties 배열에 넣습니다. 도면에 TIE 가 없으면 ties 는 빈 배열입니다.',
    '6. 한전 수전점이 **두 개 이상**인 도면(#1 수전, #2 수전)이면 parent 가 null 인 노드를 두 개 만듭니다.',
    '7. 전등·전열·예비회로처럼 같은 종류가 줄줄이 있으면 하나씩 다 넣되, 이름은 도면에 적힌 회로명',
    '   (`LP-1`, `PM-2`, `SPARE`)을 그대로 씁니다.',
    '',
    '## 지켜야 할 것',
    '- **도면에 없는 기기를 지어내지 않습니다.** 안 보이면 안 넣습니다.',
    '- 글자가 흐려 확신이 없으면 값을 null 로 두고 notes 에 어디가 불확실한지 적습니다.',
    '- 한전 수전점이 도면에 그려져 있지 않아도 계통이 한전 인입에서 시작하는 것이 명백하면',
    '  utility 노드를 맨 위에 하나 만들고 notes 에 "수전점은 도면에 없어 추가함" 이라고 적습니다.',
    '- 노드 id 는 `n1`, `n2` … 로 붙이고, parent 는 반드시 **이미 나온 노드의 id** 여야 합니다(순환 금지).',
    '- name 은 한국어로, 도면 표기를 살려서 짧게 씁니다 (예: `#1 주변압기`, `VCB-1`, `LP-3 전등분전반`).',
    '- labelText 에는 그 기기 옆에 적힌 원문을 보이는 그대로 옮깁니다.',
    '- 출력은 스키마에 맞는 JSON 하나뿐입니다. 설명 문장을 덧붙이지 않습니다.',
  ].join('\n');

  function userPrompt(input) {
    const lines = [];
    lines.push('아래는 수변전 설비의 전력계통도(단선결선도)입니다.');
    if (input.filename) lines.push(`파일명: ${input.filename}`);
    if (input.pageCount > 1) lines.push(`총 ${input.pageCount}장입니다. 한 계통이 여러 장에 걸쳐 그려져 있을 수 있으니 이어서 읽으세요.`);
    if (input.hint) lines.push(`참고: ${input.hint}`);
    if (input.textDump) {
      lines.push('');
      lines.push('이 PDF 에서 뽑아낸 글자와 위치입니다 (x=가로, y=위에서부터). 그림과 함께 참고하세요:');
      lines.push('```');
      lines.push(input.textDump);
      lines.push('```');
    }
    lines.push('');
    lines.push('도면을 판독해 계통 구조를 JSON 으로 내보내세요.');
    lines.push('맨 위 전원부터 말단 부하까지, 보이는 기기를 빠짐없이 순서대로 담으세요.');
    return lines.join('\n');
  }

  // ── 출력 스키마 ──────────────────────────────────────────────────
  const num = { type: ['number', 'null'] };
  const str = { type: ['string', 'null'] };

  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['drawingTitle', 'confidence', 'notes', 'nodes', 'ties'],
    properties: {
      drawingTitle: { ...str, description: '도면 제목 (표제란에 적힌 것)' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: '판독 확신도' },
      notes: { type: 'string', description: '불확실했던 부분·판단 근거. 없으면 빈 문자열.' },
      nodes: {
        type: 'array',
        description: '전원에서 부하 순서로 정렬된 기기 목록',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'parent', 'symbol', 'name', 'labelText'],
          properties: {
            id: { type: 'string', description: 'n1, n2 … 이 도면 안에서만 쓰는 식별자' },
            parent: { ...str, description: '전원 쪽 상위 기기 id. 최상위(한전 수전 등)는 null.' },
            symbol: { type: 'string', enum: SYMBOL_IDS, description: '기호 종류' },
            name: { type: 'string', description: '화면에 표시할 이름 (한국어, 도면 표기 반영)' },
            labelText: { ...str, description: '도면에 적힌 원문 표기 그대로' },
            tag: { ...str, description: '기기 TAG (VCB-1, TR-2 …)' },
            voltage: { ...num, description: '정격/1차 전압 (kV)' },
            secondaryVoltage: { ...num, description: '변압기 2차 전압 (kV, 380V→0.38)' },
            ratedCurrent: { ...num, description: '정격전류 AT (A)' },
            frameCurrent: { ...num, description: '프레임 AF (A)' },
            breakingCapacity: { ...num, description: '차단용량 (kA)' },
            capacityKva: { ...num, description: '변압기 용량 (kVA)' },
            ratedPower: { ...num, description: '설비 정격 (kW)' },
            poles: { ...num, description: '극수 (3P → 3)' },
            vectorGroup: { ...str, description: '변압기 결선 (Dyn11, Δ-Y …)' },
            ctRatio: { ...str, description: 'CT/PT 비 (200/5A …)' },
            cable: { ...str, description: '케이블 규격 (CN-CV 60SQ×3 …)' },
            protection: {
              type: 'array',
              description: 'ANSI 보호계전요소 코드 (50, 51, 51N, 87T …)',
              items: { type: 'string' },
            },
            zone: { ...str, description: '구역·계통 이름 (1층 동력, 사무동 …)' },
          },
        },
      },
      ties: {
        type: 'array',
        description: '모선 연락(TIE) 회로. 없으면 빈 배열.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', description: '한쪽 노드 id' },
            to: { type: 'string', description: '반대쪽 노드 id' },
            name: { ...str, description: 'TIE 회로 이름' },
            closed: { type: ['boolean', 'null'], description: '도면상 투입 상태. 보통 개방(false).' },
          },
        },
      },
    },
  };

  /** Claude Messages API 요청 본문 — 서버·브라우저가 똑같이 쓴다 */
  function buildRequest(input) {
    const content = [];
    for (const img of input.images || []) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(img.dataUrl || '');
      if (!m) continue;
      content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    content.push({ type: 'text', text: userPrompt({ ...input, pageCount: (input.images || []).length }) });

    return {
      model: input.model || MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    };
  }

  /** 응답 메시지 → 판독 JSON */
  function parseResponse(message) {
    if (!message) throw new Error('빈 응답입니다.');
    if (message.stop_reason === 'refusal') {
      throw new Error('안전 정책상 이 이미지는 판독하지 않았습니다. 다른 도면으로 시도해 주세요.');
    }
    if (message.parsed_output) return message.parsed_output;

    const text = (message.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('판독 결과를 받지 못했습니다.');

    try {
      return JSON.parse(text);
    } catch (e) {
      // 스키마 강제가 걸리지 않은 경우를 대비해 본문에서 JSON 덩어리만 골라낸다
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch (e2) {
          /* 아래로 */
        }
      }
      throw new Error('판독 결과가 JSON 이 아닙니다.');
    }
  }

  // ── 정규화 ───────────────────────────────────────────────────────
  const numOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function toSymbol(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (SYMBOL_IDS.indexOf(s) >= 0) return s;
    if (ALIASES[s]) return ALIASES[s];
    const stripped = s.replace(/[^a-z0-9가-힣]/g, '');
    if (SYMBOL_IDS.indexOf(stripped) >= 0) return stripped;
    if (ALIASES[stripped]) return ALIASES[stripped];
    return null;
  }

  /**
   * 모델 출력 → 도면에 그대로 세울 수 있는 항목 목록.
   *
   * 모델이 아무리 잘 읽어도 id 오타·순환 참조·모르는 기호는 나올 수 있다.
   * 여기서 전부 걸러 **항상 세울 수 있는 트리**로 만든다. 고친 내용은
   * warnings 로 돌려주어 화면에 그대로 보여 준다.
   */
  function normalize(raw) {
    const warnings = [];
    const inNodes = Array.isArray(raw && raw.nodes) ? raw.nodes : [];
    if (!inNodes.length) throw new Error('도면에서 기기를 찾지 못했습니다.');

    // 1) 기호·값 정리 + id 중복 제거
    const byId = new Map();
    const order = [];
    for (const n of inNodes) {
      const id = String((n && n.id) || '').trim();
      if (!id) continue;
      if (byId.has(id)) {
        warnings.push(`중복된 기기 번호 ${id} 는 한 번만 사용했습니다.`);
        continue;
      }
      let symbol = toSymbol(n.symbol);
      if (!symbol) {
        warnings.push(`모르는 기호 "${n.symbol}" → 일반 부하로 두었습니다 (${n.name || id}).`);
        symbol = 'load';
      }
      const protection = Array.isArray(n.protection)
        ? n.protection.map((p) => String(p).trim().toUpperCase()).filter(Boolean).slice(0, 8)
        : [];
      const item = {
        key: id,
        parent: n.parent == null ? null : String(n.parent).trim() || null,
        symbol,
        name: String(n.name || '').trim().slice(0, 40) || symbol,
        label: String(n.labelText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        spec: {
          tag: n.tag ? String(n.tag).trim().slice(0, 20) : null,
          voltage: numOrNull(n.voltage),
          secondaryVoltage: numOrNull(n.secondaryVoltage),
          trip: numOrNull(n.ratedCurrent),
          frame: numOrNull(n.frameCurrent),
          breakingCapacity: numOrNull(n.breakingCapacity),
          capacityKva: numOrNull(n.capacityKva),
          ratedPower: numOrNull(n.ratedPower),
          poles: numOrNull(n.poles),
          vectorGroup: n.vectorGroup ? String(n.vectorGroup).trim().slice(0, 16) : null,
          ctRatio: n.ctRatio ? String(n.ctRatio).trim().slice(0, 20) : null,
          cable: n.cable ? String(n.cable).trim().slice(0, 40) : null,
          protection,
          zone: n.zone ? String(n.zone).trim().slice(0, 20) : null,
        },
        use: true,
      };
      byId.set(id, item);
      order.push(item);
    }
    if (!order.length) throw new Error('도면에서 기기를 찾지 못했습니다.');

    // 2) 없는 부모 끊기
    for (const it of order) {
      if (it.parent && !byId.has(it.parent)) {
        warnings.push(`${it.name} 의 상위 기기(${it.parent})를 찾을 수 없어 최상위로 두었습니다.`);
        it.parent = null;
      }
      if (it.parent === it.key) it.parent = null;
    }

    // 3) 순환 끊기 — 조상을 거슬러 올라가다 자기 자신을 만나면 부모를 지운다
    for (const it of order) {
      const seen = new Set([it.key]);
      let cur = it.parent ? byId.get(it.parent) : null;
      while (cur) {
        if (seen.has(cur.key)) {
          warnings.push(`${it.name} 에서 상위 관계가 돌고 있어 끊었습니다.`);
          it.parent = null;
          break;
        }
        seen.add(cur.key);
        cur = cur.parent ? byId.get(cur.parent) : null;
      }
    }

    // 4) 부모가 먼저 오도록 정렬 (도면을 세울 때 부모가 이미 있어야 한다)
    const sorted = [];
    const done = new Set();
    const visit = (it) => {
      if (done.has(it.key)) return;
      done.add(it.key);
      if (it.parent && byId.has(it.parent)) visit(byId.get(it.parent));
      sorted.push(it);
    };
    for (const it of order) visit(it);

    const roots = sorted.filter((i) => !i.parent);
    if (!roots.length) throw new Error('계통의 시작점(수전점)을 찾지 못했습니다.');

    // 5) TIE — 양쪽 노드가 모두 있어야 한다
    const ties = [];
    for (const t of Array.isArray(raw && raw.ties) ? raw.ties : []) {
      const from = String((t && t.from) || '').trim();
      const to = String((t && t.to) || '').trim();
      if (!byId.has(from) || !byId.has(to) || from === to) continue;
      ties.push({ from, to, name: t.name ? String(t.name).slice(0, 24) : '모선 연락', closed: t.closed === true });
    }

    return {
      title: raw && raw.drawingTitle ? String(raw.drawingTitle).trim().slice(0, 60) : null,
      confidence: ['high', 'medium', 'low'].indexOf(raw && raw.confidence) >= 0 ? raw.confidence : 'medium',
      notes: raw && raw.notes ? String(raw.notes).trim() : '',
      items: sorted,
      ties,
      roots: roots.length,
      warnings,
    };
  }

  // ── 여기서부터 브라우저 전용 ─────────────────────────────────────
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  /** 저장된 API 키 (사용자 브라우저에만 남는다) */
  function getKey() {
    if (!isBrowser) return '';
    try {
      return localStorage.getItem(KEY_STORE) || '';
    } catch (e) {
      return '';
    }
  }
  function setKey(key) {
    if (!isBrowser) return;
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) {
      /* 저장 실패해도 이번 판독은 된다 */
    }
  }

  /**
   * 판독용 이미지 준비.
   * 도면은 원본이 3000px 를 넘는 일이 흔한데, 그대로 보내면 느리고 비싸다.
   * 긴 변 2576px 로 줄이되 **글자를 읽을 수 있을 만큼**은 남긴다.
   */
  function prepareImage(dataUrl, maxEdge) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      img.onload = () => {
        const long = Math.max(img.naturalWidth, img.naturalHeight);
        const limit = maxEdge || 2576;
        const scale = long > limit ? limit / long : 1;
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; // 투명 PNG 도면은 흰 바탕에 얹어야 선이 보인다
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let out = cv.toDataURL('image/jpeg', 0.92);
        for (let q = 0.82; out.length > 5.2e6 && q >= 0.5; q -= 0.16) out = cv.toDataURL('image/jpeg', q);
        resolve({ dataUrl: out, w, h });
      };
      img.src = dataUrl;
    });
  }

  /** ScadaDrawingImport 결과 → 판독 요청 입력 */
  async function prepareInput(res) {
    const pages = (res.pages && res.pages.length ? res.pages : res.underlay ? [res.underlay] : []).slice(0, 4);
    const images = [];
    for (const p of pages) {
      if (p && p.dataUrl) images.push(await prepareImage(p.dataUrl));
    }

    // 벡터 PDF 는 그림이 없을 수 있다. 대신 좌표가 붙은 글자를 넘긴다.
    let textDump = null;
    const tokens = res.tokens || [];
    if (tokens.length) {
      textDump = tokens
        .slice()
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .slice(0, 900)
        .map((t) => `(${Math.round(t.x)},${Math.round(t.y)}) ${t.text}`)
        .join('\n');
    }
    if (!images.length && !textDump) throw new Error('판독할 그림도 글자도 없습니다.');
    return { images, textDump, filename: res.filename };
  }

  /** 서버가 판독을 대신해 줄 수 있는지 (서버판에서만 참) */
  async function capability() {
    if (!isBrowser) return { server: false };
    try {
      const r = await fetch('/api/scada/ai', { headers: { accept: 'application/json' } });
      if (!r.ok) return { server: false };
      const ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') < 0) return { server: false };
      const j = await r.json();
      return { server: !!(j && j.ai), model: j && j.model };
    } catch (e) {
      return { server: false };
    }
  }

  async function callServer(input) {
    const r = await fetch('/api/scada/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `판독 서버 오류 (HTTP ${r.status})`);
    return body.analysis;
  }

  async function callDirect(input, key) {
    const body = buildRequest(input);
    const send = (payload) =>
      fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(payload),
      });

    let r = await send(body);
    if (r.status === 400) {
      // 구조화 출력을 지원하지 않는 조합이면 스키마 없이 한 번 더 — 프롬프트만으로도 JSON 이 나온다
      const text = await r.text();
      if (/output_config|json_schema/i.test(text)) {
        const relaxed = { ...body };
        delete relaxed.output_config;
        r = await send(relaxed);
      } else {
        throw new Error(apiError(text, r.status));
      }
    }
    if (!r.ok) throw new Error(apiError(await r.text(), r.status));
    return normalize(parseResponse(await r.json()));
  }

  function apiError(text, status) {
    let msg = '';
    try {
      const j = JSON.parse(text);
      msg = (j.error && j.error.message) || '';
    } catch (e) {
      /* 원문 그대로 */
    }
    if (status === 401) return 'API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.';
    if (status === 429) return '요청이 몰렸습니다. 잠시 뒤 다시 시도해 주세요.';
    if (status === 413) return '도면 이미지가 너무 큽니다. 해상도를 줄여 다시 올려 주세요.';
    return msg || `판독 요청이 실패했습니다 (HTTP ${status})`;
  }

  /**
   * 도면 판독 — 서버에 키가 있으면 서버가, 없으면 브라우저가 직접 부른다.
   * 어느 쪽이든 결과는 같은 모양이다.
   */
  async function analyze(res, opts) {
    const input = await prepareInput(res);
    const cap = (opts && opts.capability) || (await capability());
    if (cap.server) return { ...(await callServer(input)), via: 'server' };

    const key = (opts && opts.key) || getKey();
    if (!key) {
      const err = new Error('AI 판독에 쓸 API 키가 없습니다.');
      err.needKey = true;
      throw err;
    }
    const out = await callDirect(input, key);
    return { ...out, via: 'browser' };
  }

  return {
    MODEL,
    SYMBOL_IDS,
    SYSTEM_PROMPT,
    SCHEMA,
    buildRequest,
    parseResponse,
    normalize,
    toSymbol,
    // 브라우저 전용
    analyze,
    capability,
    prepareInput,
    prepareImage,
    getKey,
    setKey,
  };
});
