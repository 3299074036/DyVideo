/** 原生登录（按确认效果图）：DyVideo 原生手机号+验证码 UI，后台隐藏 WebView 跑抖音官方登录 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import NativeLoginView from '@/components/NativeLoginView';
import { useAuth } from '@/stores/auth';

export default function LoginScreen() {
  const { completeLogin } = useAuth();
  const [finishing, setFinishing] = useState(false);

  const handleLoginSuccess = useCallback(async () => {
    setFinishing(true);
    await completeLogin();
    router.back();
  }, [completeLogin]);

  return (
    <View style={styles.container}>
      <View style={styles.logo}>
        <Text style={styles.logoText}>▶</Text>
      </View>
      <Text style={styles.title}>登录 DyVideo</Text>
      <Text style={styles.sub}>登录后可看个性化推荐流</Text>

      {finishing ? (
        <View style={styles.finishing}>
          <ActivityIndicator size="large" color="#fe2c55" />
          <Text style={styles.finishingText}>登录成功，正在同步…</Text>
        </View>
      ) : (
        <NativeLoginView onLoginSuccess={handleLoginSuccess} />
      )}

      <Pressable onPress={() => router.back()} style={styles.cancelBtn}>
        <Text style={styles.cancel}>暂不登录（仅看热门）</Text>
      </Pressable>

      <Text style={styles.note}>
        验证码由抖音官方短信发送，不经过本 App{'\n'}登录态仅保存在本机
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101014',
    alignItems: 'center',
    paddingTop: 86,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logoText: { fontSize: 28, color: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  sub: { fontSize: 12, color: '#888', marginBottom: 28 },
  finishing: { height: 220, alignItems: 'center', justifyContent: 'center', gap: 12 },
  finishingText: { color: '#aaa', fontSize: 13 },
  steps: {
    fontSize: 12.5,
    color: '#aaa',
    lineHeight: 26,
    textAlign: 'center',
    marginTop: 22,
    marginBottom: 26,
  },
  stepsBold: { color: '#fff', fontWeight: '700' },
  cancelBtn: { marginTop: 18, marginBottom: 30 },
  cancel: { fontSize: 14, color: '#888' },
  note: {
    fontSize: 11,
    color: '#555',
    paddingHorizontal: 30,
    textAlign: 'center',
    lineHeight: 20,
  },
});
