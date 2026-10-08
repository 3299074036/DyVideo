/**
 * 扫码登录 WebView：加载抖音官方页，注入 JS 点出登录弹窗并只保留二维码
 * - 官方 DOM 结构可能变化：隔离失败时提供「完整页面登录」兜底
 * - 登录成功判定：原生 Cookie jar 出现 sessionid（RN 层轮询）
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { DOUYIN_ORIGIN, DOUYIN_UA, hasLoginSession } from '@/services/douyin';

const QR_ISOLATION_JS = `
(function() {
  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data})); } catch(e) {}
  }
  document.documentElement.style.background = '#101014';

  var clicked = false;
  function tryClickLogin() {
    if (clicked) return true;
    var els = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || '').trim();
      if (t === '登录' || t === '登录/注册' || t === '登录 | 注册') {
        els[i].click(); clicked = true; post('loginClicked', t); return true;
      }
    }
    var byAttr = document.querySelector('[data-e2e="login-button"]');
    if (byAttr) { byAttr.click(); clicked = true; post('loginClicked', 'attr'); return true; }
    return false;
  }

  function visibleSize(el) {
    var r = el.getBoundingClientRect();
    return Math.min(r.width, r.height);
  }

  function findQr() {
    // 优先：弹窗/dialog 里的二维码图
    var dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"]');
    var scopes = dialogs.length ? Array.prototype.slice.call(dialogs) : [document.body];
    var best = null, bestScore = 0;
    scopes.forEach(function(scope) {
      var imgs = scope.querySelectorAll('img, canvas');
      for (var i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        var src = el.src || el.getAttribute('src') || '';
        var size = visibleSize(el);
        if (size < 90 || size > 500) continue;
        if (/avatar|logo|icon|badge/i.test(src)) continue;
        var score = size + (/qrcode|qr_code|qr|scan/i.test(src) ? 1000 : 0);
        if (score > bestScore) { bestScore = score; best = el; }
      }
    });
    return best;
  }

  function isolate(el) {
    var cur = el;
    while (cur && cur !== document.body && cur.parentElement) {
      var parent = cur.parentElement;
      for (var i = 0; i < parent.children.length; i++) {
        var sib = parent.children[i];
        if (sib !== cur) sib.style.display = 'none';
      }
      cur = parent;
    }
    el.style.display = 'block';
    el.style.margin = '0 auto';
    document.body.style.background = '#ffffff';
    document.body.style.display = 'flex';
    document.body.style.alignItems = 'center';
    document.body.style.justifyContent = 'center';
    document.body.style.minHeight = '100vh';
    document.body.style.margin = '0';
  }

  var tries = 0;
  var timer = setInterval(function() {
    tries++;
    if (!clicked) {
      tryClickLogin();
      if (tries > 20) { clearInterval(timer); post('giveup', 'no-login-button'); }
      return;
    }
    var qr = findQr();
    if (qr) {
      clearInterval(timer);
      isolate(qr);
      post('qrReady', true);
    } else if (tries > 40) {
      clearInterval(timer);
      post('giveup', 'no-qr-found');
    }
  }, 500);
})();
`;

interface Props {
  onLoginSuccess: () => void;
}

export default function QrLoginView({ onLoginSuccess }: Props) {
  const [webviewKey, setWebviewKey] = useState(0);
  const [qrFailed, setQrFailed] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  // 轮询原生 Cookie：出现 sessionid 即登录成功
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      if (doneRef.current) return;
      if (await hasLoginSession()) {
        doneRef.current = true;
        onLoginSuccess();
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [onLoginSuccess]);

  const handleMessage = (e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'giveup') setQrFailed(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <View style={styles.qrBox}>
      <View style={styles.qrViewport}>
        {/* 390 逻辑宽度的页面，缩放到 152 显示，二维码约 110px */}
        <View style={styles.scaled}>
          <WebView
            key={webviewKey}
            source={{ uri: DOUYIN_ORIGIN }}
            userAgent={DOUYIN_UA}
            style={styles.webview}
            injectedJavaScript={QR_ISOLATION_JS}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
          />
        </View>
      </View>
      {qrFailed ? (
        <Pressable style={styles.fallbackBtn} onPress={() => setFullPage(true)}>
          <Text style={styles.fallbackText}>二维码加载异常，用完整页面登录 ›</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.refreshBtn} onPress={() => {
          setQrFailed(false);
          setWebviewKey((k) => k + 1);
        }}>
          <Text style={styles.fallbackText}>刷新二维码</Text>
        </Pressable>
      )}

      <Modal visible={fullPage} animationType="slide" onRequestClose={() => setFullPage(false)}>
        <View style={styles.fullWrap}>
          <View style={styles.fullBar}>
            <Pressable onPress={() => setFullPage(false)} style={styles.fullClose}>
              <Text style={styles.fullCloseText}>✕ 关闭</Text>
            </Pressable>
            <Text style={styles.fullTitle}>抖音官方登录</Text>
            <View style={{ width: 60 }} />
          </View>
          <WebView
            source={{ uri: DOUYIN_ORIGIN }}
            userAgent={DOUYIN_UA}
            style={{ flex: 1 }}
            injectedJavaScript={`
              document.documentElement.style.background = '#101014';
              true;
            `}
            javaScriptEnabled
            domStorageEnabled
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  qrBox: { alignItems: 'center' },
  qrViewport: {
    width: 180,
    height: 180,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaled: {
    width: 390,
    height: 390,
    transform: [{ scale: 180 / 390 }],
  },
  webview: { width: 390, height: 390, backgroundColor: '#fff' },
  refreshBtn: { marginTop: 10, padding: 6 },
  fallbackBtn: { marginTop: 10, padding: 6 },
  fallbackText: { color: '#fe2c55', fontSize: 12 },
  fullWrap: { flex: 1, backgroundColor: '#101014', paddingTop: 40 },
  fullBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullClose: { padding: 6 },
  fullCloseText: { color: '#fff', fontSize: 14 },
  fullTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
