'use strict';

/**
 * xlsx(=ZIP) 안의 파일 수정시각을 고정값으로 바꾼다.
 *
 * exceljs 는 ZIP 엔트리마다 "현재 시각"을 기록한다. 그래서 같은 내용을 써도
 * 실행 시각이 다르면 바이트가 달라진다. 이 파일이 빌드 산출물(단일 HTML)에
 * base64 로 실리기 때문에, 그대로 두면 **빌드할 때마다 산출물이 달라져서**
 * CI 의 "달라졌으면 커밋" 검사가 매번 참이 되고 의미 없는 커밋이 쌓인다.
 *
 * 내용은 건드리지 않고 날짜 필드만 덮어쓰므로 엑셀에서 여는 데 아무 영향이 없다.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CDIR = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// 1980년 기준 DOS 날짜/시각. 2026-01-01 00:00:00 으로 고정.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {Buffer} 날짜가 고정된 사본
 */
function normalizeZipTimestamps(input) {
  const buf = Buffer.from(input instanceof ArrayBuffer ? Buffer.from(input) : input);

  // EOCD 를 뒤에서 찾는다 (주석이 붙어 있을 수 있어 위치가 고정이 아니다)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return buf; // ZIP 이 아니면 그대로 둔다

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== SIG_CDIR) break;

    // 중앙 디렉터리 항목
    buf.writeUInt16LE(DOS_TIME, ptr + 12);
    buf.writeUInt16LE(DOS_DATE, ptr + 14);

    // 대응하는 로컬 헤더
    const localOff = buf.readUInt32LE(ptr + 42);
    if (localOff + 14 <= buf.length && buf.readUInt32LE(localOff) === SIG_LOCAL) {
      buf.writeUInt16LE(DOS_TIME, localOff + 10);
      buf.writeUInt16LE(DOS_DATE, localOff + 12);
    }

    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return buf;
}

module.exports = { normalizeZipTimestamps };
