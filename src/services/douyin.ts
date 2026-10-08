/**
 * DyVideo 数据层（2026-10-08 重构：真浏览器拦截架构）
 *
 * - feed 不再由 App 自己调接口：隐藏 WebView 拦截页面自身的
 *   /aweme/v1/web/tab/feed/ 返回（见 components/FeedInterceptor.tsx）
 * - 视频播放走 WebView 同会话（见 components/VideoCard.tsx）
 * - 这里只保留：类型定义、URL 挑选、Cookie/登录态工具、
 *   个人资料接口（我的页用，a_bogus 签名）
 */
import CookieManager from '@preeternal/react-native-cookie-manager';
import { getABogus } from '../lib/abogus';

// ------------------------------------------------------------------ 常量

/** 签名烘焙用的 UA：WebView 与签名请求必须用它，一字不差 */
export const DOUYIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36';

export const DOUYIN_ORIGIN = 'https://www.douyin.com';
const SELF_PROFILE_ENDPOINT = '/aweme/v1/web/user/profile/self/';

/** 2026-09 社区实测的公共 query 参数（browser_version 与 UA 保持一致） */
const PUBLIC_PARAMS: Record<string, string> = {
  device_platform: 'webapp',
  aid: '6383',
  channel: 'channel_pc_web',
  update_version_code: '170400',
  pc_client_type: '1',
  pc_libra_divert: 'Windows',
  support_h265: '1',
  support_dash: '1',
  cpu_core_num: '24',
  version_code: '170400',
  version_name: '17.4.0',
  cookie_enabled: 'true',
  screen_width: '1920',
  screen_height: '1080',
  browser_language: 'zh-CN',
  browser_platform: 'Win32',
  browser_name: 'Chrome',
  browser_version: '90.0.4430.212',
  browser_online: 'true',
  engine_name: 'Blink',
  engine_version: '90.0.4430.212',
  os_name: 'Windows',
  os_version: '10',
  device_memory: '8',
  platform: 'PC',
  downlink: '10',
  effective_type: '4g',
  round_trip_time: '150',
  msToken: '',
};

// ------------------------------------------------------------------ 类型

export interface DyUrlItem {
  uri: string;
  url_list: string[];
}

export interface AwemeAuthor {
  uid: string;
  nickname: string;
  avatar_thumb?: DyUrlItem;
  sec_uid?: string;
}

export interface AwemeStatistics {
  digg_count: number;
  comment_count: number;
  collect_count: number;
  share_count: number;
}

export interface Aweme {
  aweme_id: string;
  desc: string;
  create_time: number;
  aweme_type: number;
  media_type?: number;
  images?: unknown[];
  video?: {
    play_addr_h264?: DyUrlItem;
    play_addr?: DyUrlItem;
    cover?: DyUrlItem;
    origin_cover?: DyUrlItem;
  };
  author: AwemeAuthor;
  statistics: AwemeStatistics;
  music?: { title: string; author: string };
}

export interface DyUser {
  uid: string;
  nickname: string;
  avatar_thumb?: DyUrlItem;
  avatar_larger?: DyUrlItem;
  unique_id?: string;
  short_id?: string;
  signature?: string;
}

export class DouyinError extends Error {
  code: 'blocked' | 'network' | 'auth' | 'server';
  constructor(code: DouyinError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

// ------------------------------------------------------------------ 签名

/** quote_plus 风格编码：签名输入必须与实际发出的 query 字节一致 */
function quotePlus(v: string): string {
  return encodeURIComponent(v)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

export function buildQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${quotePlus(v)}`)
    .join('&');
}

/** 对最终 query 串做 a_bogus 签名，返回拼好 a_bogus 的完整 query */
export function signQuery(paramStr: string): string {
  const sig = getABogus(paramStr, 'GET');
  return `${paramStr}&a_bogus=${encodeURIComponent(sig)}`;
}

/**
 * 给页面上下文里的注入请求用的签名 path（RN 里签好 a_bogus，
 * 页面 WebView 里带 Cookie 发起）。
 * 注意：注入的裸 fetch 不经过抖音页面自身的签名逻辑，不带签会被接口拒绝——
 * 2026-10-08 换链失败就是这个原因（注释曾误写"签名由页面自己算"）。
 */
export function buildSignedApiPath(endpoint: string, bizParams: Record<string, string>): string {
  const paramStr = buildQuery({ ...PUBLIC_PARAMS, webid: genWebId(), ...bizParams });
  return `${endpoint}?${signQuery(paramStr)}`;
}

/** webid：照抄 MediaCrawler get_web_id()（19 位数字，纯客户端生成） */
export function genWebId(): string {
  const e = (t: number | null): string => {
    if (t !== null) return String(t ^ (Math.floor(16 * Math.random()) >> Math.floor(t / 4)));
    return [String(1e7), String(1e3), String(4e3), String(8e3), String(1e11)].join('-');
  };
  return e(null)
    .split('')
    .map((x) => ('018'.includes(x) ? e(parseInt(x, 10)) : x))
    .join('')
    .replace(/-/g, '')
    .slice(0, 19);
}

// ------------------------------------------------------------------ 请求

function baseHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': DOUYIN_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: `${DOUYIN_ORIGIN}/`,
    Origin: DOUYIN_ORIGIN,
    'sec-ch-ua': '"Chromium";v="90", "Google Chrome";v="90", ";Not A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    // 边缘网关 ArgusSecurityPlugin：目前不校验值，缺则 403/空回
    'x-tt-argus': '1',
    Cookie: cookie,
  };
}

async function douyinGet<T>(
  endpoint: string,
  bizParams: Record<string, string>,
  cookie: string
): Promise<T> {
  const paramStr = buildQuery({ ...PUBLIC_PARAMS, webid: genWebId(), ...bizParams });
  const url = `${DOUYIN_ORIGIN}${endpoint}?${signQuery(paramStr)}`;
  const headers = baseHeaders(cookie);
  let text: string;
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
    text = await res.text();
  } catch (e) {
    throw new DouyinError('network', `网络请求失败：${e instanceof Error ? e.message : e}`);
  }
  if (text === '' || text === 'blocked') {
    // 会话/IP 被风控拦截（机房 IP 常见；手机 residential IP 不应出现）
    throw new DouyinError('blocked', '请求被抖音风控拦截（blocked），请稍后再试');
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DouyinError('server', '接口返回非 JSON');
  }
  return data as T;
}

// ------------------------------------------------------------------ 业务接口

interface SelfProfileResponse {
  status_code: number;
  status_msg?: string;
  user?: DyUser;
}

/** 取当前登录用户信息；未登录返回 null（status_code 8） */
export async function fetchSelfProfile(cookie: string): Promise<DyUser | null> {
  const data = await douyinGet<SelfProfileResponse>(SELF_PROFILE_ENDPOINT, {}, cookie);
  if (data.status_code === 0 && data.user?.uid) return data.user;
  return null;
}

// ------------------------------------------------------------------ 过滤（v1 只留竖屏视频）

const MUSIC_PATH = /ies-music/;

/** v1 播放过滤：只要 aweme_type===0 的真视频，排除图集/直播卡片 */
export function isPlayableVideo(a: Aweme): boolean {
  if (!a || a.aweme_type !== 0) return false;
  if (a.media_type === 2) return false;
  if (Array.isArray(a.images) && a.images.length > 0) return false;
  const url = pickPlayUrl(a);
  return !!url;
}

/** 优先 play_addr_h264；取即用，不缓存 */
export function pickPlayUrl(a: Aweme): string | null {
  const urls = pickPlayUrls(a);
  return urls[0] ?? null;
}

/**
 * 取出所有候选播放地址（h264 列表 + 普通列表，去重，按 CDN 记分排序）。
 * 有些 CDN 节点会 403，换个节点可能就行；403 时先把列表试完再走详情换链。
 */
export function pickPlayUrls(a: Aweme): string[] {
  const out: string[] = [];
  const push = (u?: string) => {
    if (u && !MUSIC_PATH.test(u) && !out.includes(u)) out.push(u);
  };
  a.video?.play_addr_h264?.url_list?.forEach(push);
  a.video?.play_addr?.url_list?.forEach(push);
  // 按 CDN 记分排序：好用的域名排前面，刚失败过的沉底
  out.sort((x, y) => hostRank(hostOf(y)) - hostRank(hostOf(x)));
  return out;
}

// ------------------------------------------------------------------ CDN 记分

/** CDN 域名记分表：host -> {ok, fail}（内存，不持久化） */
const hostScore = new Map<string, { ok: number; fail: number }>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function hostRank(host: string): number {
  const s = host ? hostScore.get(host) : undefined;
  if (!s) return 0;
  return s.ok - s.fail * 2; // 失败扣分更狠，避免反复试坏节点
}

/** 上报某次播放结果，让记分表学习哪个 CDN 好用 */
export function reportHostResult(url: string, ok: boolean) {
  const host = hostOf(url);
  if (!host) return;
  const s = hostScore.get(host) ?? { ok: 0, fail: 0 };
  if (ok) s.ok += 1;
  else s.fail += 1;
  hostScore.set(host, s);
}

export function pickCoverUrl(a: Aweme): string | null {
  return a.video?.cover?.url_list?.[0] ?? a.video?.origin_cover?.url_list?.[0] ?? null;
}

// ------------------------------------------------------------------ Cookie / 登录态

const COOKIE_URL = `${DOUYIN_ORIGIN}/`;

/** 当前 Cookie jar 里拼出的 Cookie 请求头（含 ttwid / sessionid） */
export async function getCookieHeader(): Promise<string> {
  try {
    return await CookieManager.getCookieHeader(COOKIE_URL);
  } catch {
    return '';
  }
}

/** 是否已登录：jar 里有 sessionid / sessionid_ss 即认为已登录 */
export async function hasLoginSession(): Promise<boolean> {
  try {
    const cookies = await CookieManager.get(COOKIE_URL);
    return !!(cookies.sessionid || cookies.sessionid_ss);
  } catch {
    return false;
  }
}

/** 退出登录核心：清原生 Cookie jar（不清会导致官方页仍自动登录） */
export async function clearNativeCookies(): Promise<void> {
  try {
    await CookieManager.clearAll();
  } catch {
    /* best-effort */
  }
}
