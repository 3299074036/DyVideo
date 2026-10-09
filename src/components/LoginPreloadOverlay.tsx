/**
 * 预加载登录浮层（共享组件）：挂载即后台隐身跑抖音登录页并自动点出登录框，
 * visible=true 时全屏显示（表单已开好，秒弹）。登录成功自动回调 onLoginSuccess。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { DOUYIN_ORIGIN, DOUYIN_UA, hasLoginSession } from '@/services/douyin';

type Props = {
  visible: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
};

/** 后台自动点出登录弹窗并隔离，全程上报诊断 */
const PRELOAD_LOGIN_JS = `
(function() {
  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data || '' })); } catch (e) {}
  }
  post('diag', 'JS已注入');
  function findModal() {
    var all = document.querySelectorAll('div');
    for (var i = all.length - 1; i >= 0; i--) {
      var t = all[i].innerText || '';
      if (t.length < 2000 && (t.indexOf('验证码登录') >= 0 || t.indexOf('短信登录') >= 0 || t.indexOf('手机号登录') >= 0)) return all[i];
    }
    // 兜底：找手机号输入框（登录表单的特征）
    var tel = document.querySelector('input[type="tel"], input[placeholder*="手机号"], input[placeholder*="手机"]');
    if (tel && tel.offsetParent !== null) {
      var p = tel;
      for (var d = 0; d < 6 && p.parentElement; d++) p = p.parentElement;
      return p;
    }
    return null;
  }
  function modalOpen() { return !!findModal(); }
  function isolateModal() {
    var modal = findModal();
    if (!modal) return false;
    var top = modal;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== top) kids[i].style.display = 'none';
    }
    document.body.style.background = '#fff';
    return true;
  }
  function forceClick(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) {}
    try {
      var r = el.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      });
      return true;
    } catch (e) { return false; }
  }
  function findByText(texts) {
    // 优先找真正的按钮，其次才找 span/div；同一文本找最内层（最可能是可点击的）
    var sels = ['button', 'a', '[role="button"]', 'span', 'div'];
    for (var s = 0; s < sels.length; s++) {
      var els = document.querySelectorAll(sels[s]);
      var best = null, bestDepth = 9999;
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].innerText || '').trim();
        if (t.length === 0 || t.length > 12) continue;
        for (var j = 0; j < texts.length; j++) {
          if (t === texts[j]) {
            var d = 0, p = els[i];
            while (p.parentElement) { d++; p = p.parentElement; }
            if (d < bestDepth) { bestDepth = d; best = els[i]; }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
  if (modalOpen()) { isolateModal(); post('modal-open', ''); return; }
  var tries = 0;
  var clickedMe = false;
  var timer = setInterval(function() {
    tries++;
    if (modalOpen()) { clearInterval(timer); isolateModal(); post('modal-open', '已检测到弹窗'); return; }
    var loginBtn = findByText(['登录', '登录/注册']);
    if (loginBtn) {
      forceClick(loginBtn);
      post('diag', '已点登录按钮,等待弹窗…');
      return;
    }
    if (!clickedMe && tries >= 4) {
      var meTab = findByText(['我的']);
      if (meTab) {
        forceClick(meTab);
        clickedMe = true;
        post('diag', '已点"我的",等待个人页…');
        tries = 0;
        return;
      }
    }
    if (tries === 8) post('diag', '还没找到,再试几次…');
    if (tries > 30) { clearInterval(timer); post('diag', '超时,请手动点页面上的登录'); }
  }, 800);
})();
true;
`;

export default function LoginPreloadOverlay({ visible, onClose, onLoginSuccess }: Props) {
  const [loginReady, setLoginReady] = useState(false);
  const [diag, setDiag] = useState('等待页面…');
  const doneRef = useRef(false);

  // 登录成功轮询
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(async () => {
      if (doneRef.current) return;
      if (await hasLoginSession()) {
        doneRef.current = true;
        onLoginSuccess();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [visible, onLoginSuccess]);

  const handleMessage = (e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'modal-open') {
        setLoginReady(true);
        setDiag('弹窗已打开');
      } else if (msg.type === 'diag') {
        setDiag(String(msg.data || ''));
      }
    } catch {
      /* ignore */
    }
  };

  // 诊断版：直接显示 WebView，所见即所得
  return (
    <View style={visible ? styles.overlay : styles.hidden} pointerEvents={visible ? 'auto' : 'none'}>
      {visible && (
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title}>登录 DyVideo</Text>
          <View style={styles.closeBtn} />
        </View>
      )}
      <View style={styles.wvWrap}>
        <WebView
          source={{ uri: DOUYIN_ORIGIN }}
          userAgent={DOUYIN_UA}
          style={styles.wv}
          injectedJavaScript={PRELOAD_LOGIN_JS}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
      {visible && (
        <Text style={styles.diagText}>{diag}</Text>
      )}
      {visible && (
        <Text style={styles.note}>验证码由抖音官方短信发送，不经过本 App{'\n'}登录态仅保存在本机</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: -10000,
    left: 0,
    width: '100%',
    height: 500,
    opacity: 0,
  },
  preloadWvWrap: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#101014',
    paddingTop: 56,
    paddingHorizontal: 18,
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  closeBtn: { width: 40, padding: 8 },
  closeText: { color: '#888', fontSize: 18 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  wvWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    minHeight: 420,
  },
  wv: { flex: 1, backgroundColor: '#fff' },
  loading: { position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center' },
  loadingText: { color: '#888', fontSize: 13, marginTop: 12 },
  diagText: { color: '#888', fontSize: 11, marginTop: 8, textAlign: 'center' },
  note: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 12,
    marginBottom: 8,
  },
});
