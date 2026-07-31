/* global window, document, Image, Blob, URL */
'use strict';

/**
 * 도면 → PDF 내보내기 (외부 라이브러리 없음).
 *
 * 왜 직접 만드나:
 *  - 아티팩트/정적 호스팅 모두 CSP 로 외부 스크립트를 막는다. jsPDF 를 못 쓴다.
 *  - PDF 표준 폰트(Helvetica 등)에는 한글이 없다. 텍스트를 PDF 문자열로 넣으면
 *    설비명이 전부 깨진다. 그래서 **도면과 표제란을 캔버스에 그려 한 장의
 *    이미지로 만든 뒤** PDF 에 얹는다. 한글이 그대로 나오고, 어느 뷰어에서도
 *    같게 보인다.
 *  - JPEG 은 PDF 가 /DCTDecode 로 원본 바이트를 그대로 받으므로 압축기(zlib)가
 *    필요 없다. 그래서 JPEG 을 쓴다.
 *
 * 산출물은 A3 가로 한 장 + 도면 상단 표제란(회사/도면명/수전점/축척/작성일).
 */
window.ScadaPdf = (function () {
  // ── 용지 (pt 단위, 1pt = 1/72 inch) ──────────────────────────────
  const PAPER = {
    A3: { w: 1190.55, h: 841.89 }, // 420 × 297 mm 가로
    A4: { w: 841.89, h: 595.28 }, // 297 × 210 mm 가로
  };
  const MARGIN = 24;

  /** SVG 문자열 → HTMLImageElement */
  function svgToImage(svgText) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('도면 이미지를 만들지 못했습니다.'));
      };
      img.src = url;
    });
  }

  /** 표제란 — 도면 위쪽 띠. 캔버스에 직접 그리므로 한글이 깨지지 않는다. */
  function drawTitleBlock(ctx, W, H, info) {
    const pad = 18;
    ctx.fillStyle = '#111a2e';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#24345c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - 0.5);
    ctx.lineTo(W, H - 0.5);
    ctx.stroke();

    const font = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';

    ctx.fillStyle = '#eef3fb';
    ctx.font = `700 ${Math.round(H * 0.30)}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(info.title || 'SCADA 단선결선도', pad, H * 0.36);

    ctx.fillStyle = '#a8b8d6';
    ctx.font = `${Math.round(H * 0.20)}px ${font}`;
    ctx.fillText(info.subtitle || '', pad, H * 0.72);

    // 오른쪽 메타 (항목 = 값)
    const items = (info.meta || []).filter((m) => m[1] != null && m[1] !== '');
    const colW = Math.min(210, (W - pad * 2) / Math.max(items.length, 1));
    let x = W - pad - colW * items.length;
    for (const [k, v] of items) {
      ctx.fillStyle = '#6d80a6';
      ctx.font = `${Math.round(H * 0.17)}px ${font}`;
      ctx.fillText(String(k), x, H * 0.34);
      ctx.fillStyle = '#eef3fb';
      ctx.font = `600 ${Math.round(H * 0.21)}px ${font}`;
      ctx.fillText(String(v), x, H * 0.68);
      x += colW;
    }
  }

  // ── 최소 PDF 라이터 ──────────────────────────────────────────────
  const enc = new TextEncoder();

  /**
   * JPEG 한 장을 한 페이지에 얹은 PDF 바이트 생성.
   * 객체 오프셋을 세어 xref 를 직접 쓴다 (PDF 는 바이트 위치 기반이라 필수).
   */
  function buildPdf(jpegBytes, imgW, imgH, pageW, pageH, drawW, drawH, offsetX, offsetY) {
    const chunks = [];
    const offsets = [0];
    let length = 0;

    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const startObject = () => offsets.push(length);

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    startObject();
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    startObject();
    push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    startObject();
    push(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
    );

    startObject();
    push(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    push(jpegBytes);
    push('\nendstream\nendobj\n');

    // PDF 좌표계는 좌하단 원점이라 y 를 뒤집어 배치한다
    const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    startObject();
    push(`5 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

    const xrefStart = length;
    let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('이미지 변환에 실패했습니다.'));
          blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))).catch(reject);
        },
        'image/jpeg',
        quality
      );
    });
  }

  /**
   * 도면 SVG → PDF 바이트
   * @param {string} svgText   내보낼 SVG (스타일이 안에 박혀 있어야 한다)
   * @param {object} info      { title, subtitle, meta: [[라벨,값], …], paper: 'A3'|'A4' }
   */
  async function fromSvg(svgText, info = {}) {
    const paper = PAPER[info.paper] || PAPER.A3;
    const img = await svgToImage(svgText);

    const srcW = img.naturalWidth || img.width || 1200;
    const srcH = img.naturalHeight || img.height || 800;

    const availW = paper.w - MARGIN * 2;
    const availH = paper.h - MARGIN * 2;

    // 인쇄 선명도: 배치될 크기의 약 2.1배로 래스터화 (≈150dpi).
    // 캔버스 상한을 두어 큰 도면에서도 메모리가 터지지 않게 한다.
    const canvasW = Math.min(4200, Math.max(1200, Math.round(availW * 2.1)));
    const scale = canvasW / srcW;
    const bandH = Math.round(52 * (canvasW / 1400)) + 26; // 표제란 높이
    const canvasH = Math.round(srcH * scale) + bandH;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = Math.min(canvasH, 8000);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTitleBlock(ctx, canvas.width, bandH, info);
    ctx.drawImage(img, 0, bandH, canvas.width, canvas.height - bandH);

    const jpeg = await canvasToJpeg(canvas, 0.92);

    // 페이지 안에 비율 유지로 배치 (표제란까지 한 덩어리)
    const drawScale = Math.min(availW / canvas.width, availH / canvas.height);
    const drawW = canvas.width * drawScale;
    const drawH = canvas.height * drawScale;
    const offsetX = (paper.w - drawW) / 2;
    const offsetY = paper.h - MARGIN - drawH;

    return buildPdf(jpeg, canvas.width, canvas.height, paper.w, paper.h, drawW, drawH, offsetX, offsetY);
  }

  return { fromSvg, buildPdf, PAPER };
})();
