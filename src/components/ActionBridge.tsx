/**
 * ActionBridge v2（DOM 路线）：
 * 不再调接口，改为加载视频详情页，直接点页面原生的点赞/收藏/关注按钮。
 * 按钮是抖音自己的，点击后它自己的 JS 发请求、自己算签名，我们只负责点。
 *
 * 用法：bridgeRef.current.digg(awemeId, true)
 */
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { DOUYIN_ORIGIN, DOUYIN_UA } from '@/services/douyin';

export interface ActionBridgeRef {
  digg: (awemeId: string, like: boolean) => Promise<{ ok: boolean; msg: string }>;
  collect: (awemeId: string, collect: boolean) => Promise<{ ok: boolean; msg: string }>;
  follow: (awemeId: string, follow: boolean) => Promise<{ ok: boolean; msg: string }>;
  fetchComments: (awemeId: string) => Promise<{ ok: boolean; msg: string; comments?: any[] }>;
  publishComment: (awemeId: string, text: string) => Promise<{ ok: boolean; msg: string }>;
}

type Pending = {
  resolve: (v: { ok: boolean; msg: string; comments?: any[] }) => void;
  timer: ReturnType<typeof setTimeout>;
  kind: string;
  wantState: boolean; // 期望点完后的状态（true=已点赞/已收藏/已关注）
};

/**
 * 在视频详情页里找按钮并点。返回点击后按钮的状态。
 * 找法：aria-label > 文字匹配，找最内层的 button。
 */
const CLICK_JS = `
(function() {
  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data })); } catch (e) {}
  }

  function findBtn(keywords) {
    var btns = document.querySelectorAll('button, [role="button"]');
    var best = null;
    for (var i = 0; i < btns.length; i++) {
      var el = btns[i];
      var label = (el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '') + ' ' + (el.getAttribute('data-e2e') || '');
      for (var k = 0; k < keywords.length; k++) {
        if (label.indexOf(keywords[k]) >= 0) {
          // 要最内层的（避免点到外层容器）
          if (!best || el.contains(best)) best = el;
          else if (!best.contains(el)) { /* 同级，取第一个 */ }
          break;
        }
      }
    }
    return best;
  }

  function isActive(el) {
    if (!el) return false;
    var label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('aria-pressed') || '');
    if (label.indexOf('已') >= 0 || el.getAttribute('aria-pressed') === 'true') return true;
    var cls = el.className || '';
    if (typeof cls === 'string' && (cls.indexOf('active') >= 0 || cls.indexOf('liked') >= 0)) return true;
    return false;
  }

  function click(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try {
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      });
    } catch (e) { try { el.click(); } catch (_) {} }
  }

  window.__dyClickAction = function(kind, wantState) {
    var keywords = [];
    if (kind === 'digg') keywords = ['点赞'];
    else if (kind === 'collect') keywords = ['收藏'];
    else if (kind === 'follow') keywords = ['关注'];
    else { post('action-result', { ok: false, msg: '未知动作' }); return; }

    var tries = 0;
    var timer = setInterval(function() {
      tries++;
      var btn = findBtn(keywords);
      if (btn) {
        clearInterval(timer);
        var before = isActive(btn);
        post('diag', '找到按钮[' + keywords[0] + '] 当前状态:' + (before ? '已点' : '未点'));
        if (before === wantState) {
          post('action-result', { ok: true, msg: '已是目标状态，无需点击' });
          return;
        }
        click(btn);
        // 等 2 秒后检查状态
        setTimeout(function() {
          var after = isActive(btn);
          // 再找一次按钮（DOM 可能重渲染）
          var btn2 = findBtn(keywords);
          var finalState = btn2 ? isActive(btn2) : after;
          post('action-result', { ok: finalState === wantState, msg: finalState === wantState ? 'ok' : '点击后状态未变' });
        }, 2000);
        return;
      }
      if (tries > 20) {
        clearInterval(timer);
        post('action-result', { ok: false, msg: '20次未找到[' + keywords[0] + ']按钮' });
      }
    }, 800);
  };

  /** 从详情页提取评论列表 */
  window.__dyGetComments = function() {
    try {
      // 尝试从 __NEXT_DATA__ 拿
      var nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        var data = JSON.parse(nextData.textContent);
        // 结构复杂，直接返回让 RN 解析太麻烦，走 DOM
      }
      // DOM 提取：找评论元素
      var comments = [];
      // 抖音评论通常在 [data-e2e*="comment"] 或特定 class 里
      var items = document.querySelectorAll('[data-e2e*="comment-item"], .comment-item');
      for (var i = 0; i < Math.min(items.length, 20); i++) {
        var el = items[i];
        var textEl = el.querySelector('[data-e2e*="comment-text"], .comment-text, span');
        var userEl = el.querySelector('[data-e2e*="comment-user"], .comment-user');
        comments.push({
          cid: 'dom-' + i,
          text: textEl ? textEl.innerText.slice(0, 200) : el.innerText.slice(0, 200),
          create_time: Date.now() / 1000,
          digg_count: 0,
          reply_count: 0,
          user: { uid: '', nickname: userEl ? userEl.innerText.slice(0, 20) : '用户' },
        });
      }
      post('action-result', { ok: true, msg: 'ok', comments: comments });
    } catch (e) {
      post('action-result', { ok: false, msg: '提取失败:' + e.message });
    }
  };

  post('bridge-ready', {});
})();
true;
`;

const ActionBridge = forwardRef<ActionBridgeRef>(function ActionBridge(_, ref) {
  const wvRef = useRef<React.ElementRef<typeof WebView>>(null);
  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState('about:blank');
  const pendingRef = useRef<Pending | null>(null);
  const readyRef = useRef(false);

  const runAction = (
    kind: 'digg' | 'collect' | 'follow' | 'comment-list',
    awemeId: string,
    wantState: boolean
  ): Promise<{ ok: boolean; msg: string; comments?: any[] }> => {
    return new Promise((resolve) => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current.resolve({ ok: false, msg: '被新动作顶掉' });
      }
      const timer = setTimeout(() => {
        pendingRef.current = null;
        resolve({ ok: false, msg: '动作超时(30s)' });
      }, 30000);
      pendingRef.current = { resolve, timer, kind, wantState };
      // 加载视频详情页，onLoadEnd 后注入对应脚本
      setUrl(`${DOUYIN_ORIGIN}/video/${awemeId}`);
    });
  };

  const handleLoadEnd = () => {
    const p = pendingRef.current;
    if (!p || !wvRef.current) return;
    setTimeout(() => {
      if (p.kind === 'comment-list') {
        wvRef.current?.injectJavaScript(`window.__dyGetComments && window.__dyGetComments(); true;`);
      } else {
        wvRef.current?.injectJavaScript(
          `window.__dyClickAction && window.__dyClickAction(${JSON.stringify(p.kind)}, ${p.wantState}); true;`
        );
      }
    }, 1500);
  };

  useImperativeHandle(ref, () => ({
    digg: (awemeId, like) => runAction('digg', awemeId, like),
    collect: (awemeId, collect) => runAction('collect', awemeId, collect),
    follow: (awemeId, follow) => runAction('follow', awemeId, follow),
    fetchComments: (awemeId) => runAction('comment-list', awemeId, false),
    publishComment: async () => ({ ok: false, msg: '发评论 DOM 版待实现' }),
  }), []);

  const handleMessage = (e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'bridge-ready') {
        readyRef.current = true;
        setReady(true);
      } else if (msg.type === 'action-result') {
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) {
          clearTimeout(p.timer);
          p.resolve({
            ok: !!msg.data?.ok,
            msg: String(msg.data?.msg ?? ''),
            comments: msg.data?.comments,
          });
        }
        // 回到空白页，省资源
        setUrl('about:blank');
      } else if (msg.type === 'diag') {
        // 诊断小字暂只打日志
        console.log('[ActionBridge]', msg.data);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={wvRef}
        source={{ uri: url }}
        userAgent={DOUYIN_UA}
        style={styles.wv}
        injectedJavaScript={CLICK_JS}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: -10000,
    left: 0,
    width: '100%',
    height: 500,
    opacity: 0,
  },
  wv: { flex: 1 },
});

export default ActionBridge;
