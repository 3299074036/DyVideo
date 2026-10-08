/**
 * a_bogus 签名（vendor 自 randallanjie/douyin-api，2026-10-07 验证可用）
 *
 * 重要：该实现的 UA_CODE 是按 Chrome 90 UA 烘焙的常量，
 * 发请求必须用 services/douyin.ts 里导出的 DOUYIN_UA，两者必须完全一致。
 */
export function getABogus(
  urlParams: string,
  method?: 'GET' | 'POST',
  opts?: {
    random1?: number;
    random2?: number;
    random3?: number;
    startTime?: number;
    endTime?: number;
  }
): string;
