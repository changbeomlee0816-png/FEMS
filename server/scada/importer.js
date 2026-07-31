'use strict';

const { Workbook } = require('./workbook');
const { parseWorkbook } = require('./parser');
const { validate } = require('./validator');
const { buildModel } = require('./model');
const { buildDiagram } = require('./diagram');

/**
 * 업로드 파이프라인: 엑셀 버퍼 → 검증 리포트 + 모델 + 도면.
 *
 *  parse ─► validate ─► (오류 0건이면) build model ─► build diagram
 *
 * 오류가 있으면 도면은 만들지 않고 리포트만 돌려준다.
 * `tolerant: true` 로 부르면 오류가 있어도 만들 수 있는 만큼 도면을 만든다(미리보기용).
 */
async function importWorkbook(buffer, opts = {}) {
  let wb;
  try {
    wb = await Workbook.fromBuffer(buffer);
  } catch (e) {
    return {
      ok: false,
      stage: 'read',
      report: {
        ok: false,
        errorCount: 1,
        warningCount: 0,
        infoCount: 0,
        issues: [
          {
            level: 'error',
            code: 'UNREADABLE_FILE',
            sheet: null,
            cell: null,
            column: '파일',
            value: opts.filename || null,
            message: '엑셀 파일을 열 수 없습니다. 손상되었거나 지원하지 않는 형식입니다.',
            hint: '.xlsx 형식으로 다시 저장한 뒤 업로드하세요. (.xls / .csv 는 지원하지 않습니다)',
          },
        ],
        summary: {},
      },
    };
  }

  const parsed = parseWorkbook(wb);
  const report = validate(parsed);
  delete report.ctx; // 내부 인덱스는 응답에 싣지 않는다

  if (!report.ok && !opts.tolerant) {
    return { ok: false, stage: 'validate', report, sheetNames: parsed.sheetNames };
  }

  const model = buildModel(parsed);
  const diagram = buildDiagram(model, { name: opts.name });

  return { ok: report.ok, stage: 'build', report, model, diagram, sheetNames: parsed.sheetNames };
}

module.exports = { importWorkbook };
