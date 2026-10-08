/**
 * FeedInterceptor：隐藏 WebView，真浏览器会话拦截抖音页面自己的 feed 接口返回。
 *
 * 原理（myfollows 路线）：
 * 1. WebView 加载 https://www.douyin.com/（真浏览器，WAF 放行）
 * 2. 注入 JS 改写 window.fetch / XMLHttpRequest，页面自己调
 *    /aweme/v1/web/tab/feed/ 时把响应的 JSON 抓出来
 * 3. 通过 postMessage 把 JSON 传给 RN，App 不再自己算 a_bogus 调接口
 * 4. 拦截到的 play_addr 是页面会话生成的，同 Cookie 的 WebView 播它不会 403
 * 5. play_url 是有时效的签名：播放遇到 403 时，用详情接口
 *    （/aweme/v1/web/aweme/detail/，页面上下文带 Cookie 调用，不带 a_bogus）
 *    换一条新鲜的再重试
 *
 * 诊断模式（debug=true）：上报所有 /aweme/ 请求的 URL，方便排查页面行为。
 */
import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Aweme, DOUYIN_ORIGIN, DOUYIN_UA } from '@/services/douyin';

/** 注入脚本：在页面 JS 环境里改写 fetch 和 XHR */
const INJECTED_JS = (debug: boolean) => `
(function() {
  if (window.__dyHooked) return;
  window.__dyHooked = true;
  var DEBUG = ${debug ? 'true' : 'false'};

  var FEED_PATTERNS = [
    '/aweme/v1/web/tab/feed/',
    '/aweme/v1/web/follow/feed/',
    '/aweme/v1/web/aweme/detail/',
    '/aweme/v1/web/aweme/post/'
  ];

  function isFeedUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return FEED_PATTERNS.some(function(p) { return url.indexOf(p) !== -1; });
  }

  function isAwemeApi(url) {
    return url && typeof url === 'string' && url.indexOf('/aweme/') !== -1;
  }

  function post(type, data) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(
        Object.assign({ type: type }, data || {})
      ));
    } catch (e) {}
  }

  function reportFeed(url, body) {
    post('FEED_RESPONSE', { url: url, body: body });
  }

  // hook fetch
  var origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
    if (DEBUG && isAwemeApi(url)) post('API_HIT', { url: String(url).slice(0, 200) });
    var p = origFetch.apply(this, args);
    if (isFeedUrl(url)) {
      p.then(function(resp) {
        try {
          var clone = resp.clone();
          clone.text().then(function(text) { reportFeed(url, text); }).catch(function(){});
        } catch (e) {}
      }).catch(function(){});
    }
    return p;
  };

  // hook XHR
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__dyUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var self = this;
    if (DEBUG && isAwemeApi(self.__dyUrl)) post('API_HIT', { url: String(self.__dyUrl).slice(0, 200) });
    if (isFeedUrl(self.__dyUrl)) {
      self.addEventListener('load', function() {
        try { reportFeed(self.__dyUrl, self.responseText); } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // 上报页面状态（标题/URL），方便判断是否撞到验证码墙
  function reportState() {
    post('PAGE_STATE', { title: document.title, url: location.href });
  }
  if (document.readyState === 'complete') reportState();
  else window.addEventListener('load', reportState);
  setTimeout(reportState, 8000);

  post('HOOK_READY');
})();
true;
`;

/** 页面自己拉 feed（翻页/首屏补救）：页面上下文带 Cookie 发起，不带 a_bogus。
 * 2026-10-08 实测：自签名的 a_bogus 被 WAF 报 "Sign Invalid" 直接 403，
 * 不带签名的版本（16:29）feed 正常，故回退；诊断上报保留。
 * 诊断版：单独上报本次请求的状态码和正文前 150 字 */
export function buildFeedRequestJS(refreshIndex: number): string {
  // 小批量抓取：play_url 有效期很短（约1-2分钟），一次抓太多后面的播时已过期 → 403。
  // 改成一次 3 条，快刷到底时自动续抓，保证播的时候地址都是新鲜的，减少对详情换链的依赖。
  const urlPrefix = '/aweme/v1/web/tab/feed/?count=3';
  return `
(function() {
  var url = '${urlPrefix}&refresh_index=${refreshIndex}&tab=&type=0'
    + '&device_platform=webapp&aid=6383&channel=channel_pc_web';
  function done(ok, status, body) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'RESCUE_RESULT', ok: !!ok, status: status,
        body: String(body || '').slice(0, 150)
      }));
    } catch(e){}
  }
  fetch(url, { credentials: 'include' })
    .then(function(r){
      return r.text().then(function(t){
        done(r.ok, r.status, t);
        // 走正常数据通道：成功时页面解析入库
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'FEED_RESPONSE', url: url, body: t
          }));
        } catch(e){}
      });
    })
    .catch(function(e){ done(false, -1, String((e && e.message) || e)); });
})();
true;
`;
}

export interface RescueResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface InterceptedFeed {
  url: string;
  body: string;
}

/** 用详情接口换新鲜 play_url（403/405 时的 myfollows 策略）：页面上下文带 Cookie 发起，不带 a_bogus。
 * 2026-10-08 实测：自签名的 a_bogus 被 WAF 报 "Sign Invalid" 直接 403，故回退到不带签名版本。
 * 诊断版：上报 HTTP 状态和正文前 200 字（区分被拒/API 报错/超时） */
export function buildDetailRequestJS(reqId: string, awemeId: string): string {
  const safeId = awemeId.replace(/[^0-9]/g, '');
  return `
(function() {
  var reqId = ${JSON.stringify(reqId)};
  var url = '/aweme/v1/web/aweme/detail/?aweme_id=${safeId}'
    + '&device_platform=webapp&aid=6383&channel=channel_pc_web';
  function done(ok, status, body) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'DETAIL_RESULT', reqId: reqId, ok: !!ok, status: status,
        body: String(body || '').slice(0, 200)
      }));
    } catch(e){}
  }
  fetch(url, { credentials: 'include' })
    .then(function(r){ return r.text().then(function(t){ done(r.ok, r.status, t); }); })
    .catch(function(e){ done(false, -1, String((e && e.message) || e)); });
})();
true;
`;
}

export interface DetailResult {
  reqId: string;
  ok: boolean;
  status: number;
  body: string;
}

/** 换链结果：aweme 为 null 时看 diag 定位 */
export interface RefreshPlayUrlResult {
  aweme: Aweme | null;
  diag: string;
}

export interface ApiHit {
  url: string;
}

export interface PageState {
  title: string;
  url: string;
}

interface Props {
  onFeed: (feed: InterceptedFeed) => void;
  onReady?: () => void;
  onApiHit?: (hit: ApiHit) => void;
  onPageState?: (state: PageState) => void;
  onDetailResult?: (result: DetailResult) => void;
  onRescueResult?: (result: RescueResult) => void;
  debug?: boolean;
}

type WebViewRef = React.ElementRef<typeof WebView>;

/**
 * 隐藏的拦截 WebView。挂载后加载抖音首页，页面自己的 feed 请求会被抓到。
 */
const FeedInterceptor = React.forwardRef<WebViewRef, Props>(
  ({ onFeed, onReady, onApiHit, onPageState, onDetailResult, onRescueResult, debug = false }, ref) => {
    const js = useRef(INJECTED_JS(debug)).current;

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === 'FEED_RESPONSE' && msg.body) {
            onFeed({ url: msg.url, body: msg.body });
          } else if (msg.type === 'HOOK_READY') {
            onReady?.();
          } else if (msg.type === 'API_HIT') {
            onApiHit?.({ url: msg.url });
          } else if (msg.type === 'PAGE_STATE') {
            onPageState?.({ title: msg.title, url: msg.url });
          } else if (msg.type === 'DETAIL_RESULT') {
            onDetailResult?.({ reqId: msg.reqId, ok: !!msg.ok, status: Number(msg.status) || 0, body: msg.body || '' });
          } else if (msg.type === 'RESCUE_RESULT') {
            onRescueResult?.({ ok: !!msg.ok, status: Number(msg.status) || 0, body: msg.body || '' });
          }
        } catch {
          /* 忽略非 JSON 消息 */
        }
      },
      [onFeed, onReady, onApiHit, onPageState, onDetailResult, onRescueResult]
    );

    return (
      <WebView
        ref={ref}
        source={{ uri: DOUYIN_ORIGIN }}
        userAgent={DOUYIN_UA}
        style={styles.hidden}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={js}
        injectedJavaScript={js}
        onMessage={handleMessage}
        mediaPlaybackRequiresUserAction={false}
      />
    );
  }
);

export default FeedInterceptor;

const styles = StyleSheet.create({
  hidden: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    top: -10,
    left: -10,
  },
});
