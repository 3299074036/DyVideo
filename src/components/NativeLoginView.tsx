/**
 * 官方登录页直用版：WebView 直接加载抖音官方页，自动点出登录弹窗，
 * 用户在官方弹窗里完成手机号/验证码登录。不做原生桥接，不填表，
 * 简单可靠。登录成功判定：轮询原生 Cookie jar 的 sessionid。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { DOUYIN_ORIGIN, DOUYIN_UA, hasLoginSession } from '@/services/douyin';

type Props = { onLoginSuccess: () => void };

/** 登录弹窗打开后，只留弹窗（藏起首页其他内容），通过 postMessage 上报状态 */
const AUTO_LOGIN_JS = `
(function() {
  function post(type, data) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data || '' })); } catch (e) {}
  }
  function findModal() {
    var all = document.querySelectorAll('div');
    for (var i = all.length - 1; i >= 0; i--) {
      var t = all[i].innerText || '';
      if (t.indexOf('验证码登录') >= 0 && t.length < 2000) return all[i];
    }
    return null;
  }
  function modalOpen() { return !!findModal(); }
  // 只留登录弹窗：把 body 下除弹窗顶层容器外的元素全部隐藏
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
  var tries = 0;
  var timer = setInterval(function() {
    tries++;
    if (modalOpen()) { clearInterval(timer); isolateModal(); post('modal-open', ''); return; }
    var els = document.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || '').trim();
      if (t === '登录' || t === '登录/注册' || t === '登录 | 注册') { els[i].click(); return; }
    }
    var byAttr = document.querySelector('[data-e2e="login-button"]');
    if (byAttr) byAttr.click();
    if (tries === 12) post('diag', '正在打开登录框…');
  }, 800);
})();
true;
`;

export default function NativeLoginView({ onLoginSuccess }: Props) {
  const [wvKey, setWvKey] = useState(0);
  const [diag, setDiag] = useState('正在打开登录框…');
  const [wvVisible, setWvVisible] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const t = setInterval(async () => {
      if (doneRef.current) return;
      if (await hasLoginSession()) {
        doneRef.current = true;
        onLoginSuccess();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [onLoginSuccess]);

  // 兜底：12 秒还没收到弹窗消息，就把 WebView 显示出来让用户手动点
  useEffect(() => {
    const t = setTimeout(() => {
      setWvVisible((v) => {
        if (!v) setDiag('自动打开较慢，可在下方页面手动点"登录"');
        return true;
      });
    }, 12000);
    return () => clearTimeout(t);
  }, [wvKey]);

  const handleMessage = (e: { nativeEvent: { data: string } }) => {
    let msg: { type?: string; data?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'modal-open') {
      setWvVisible(true);
      setDiag('在上方登录框完成登录，成功后自动进入');
    } else if (msg.type === 'diag') {
      setDiag(String(msg.data || ''));
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.wvBox, !wvVisible && styles.wvHidden]}>
        <WebView
          key={wvKey}
          source={{ uri: DOUYIN_ORIGIN }}
          userAgent={DOUYIN_UA}
          style={styles.webview}
          injectedJavaScript={AUTO_LOGIN_JS}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
      {!wvVisible && <Text style={styles.loadingText}>正在打开登录框…</Text>}
      <Text style={styles.diagText}>{diag}</Text>
      <Pressable
        style={styles.refreshBtn}
        onPress={() => {
          setWvVisible(false);
          setDiag('正在重新加载…');
          setWvKey((k) => k + 1);
        }}
      >
        <Text style={styles.refreshText}>刷新页面</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', paddingHorizontal: 28, alignItems: 'center' },
  wvBox: {
    width: '100%',
    height: 420,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  wvHidden: { opacity: 0, height: 200 },
  loadingText: { color: '#888', fontSize: 13, marginTop: 80, marginBottom: 80 },
  webview: { flex: 1, backgroundColor: '#fff' },
  diagText: { color: '#888', fontSize: 11, marginTop: 8, textAlign: 'center' },
  refreshBtn: { marginTop: 8, padding: 6 },
  refreshText: { color: '#fe2c55', fontSize: 12 },
});
