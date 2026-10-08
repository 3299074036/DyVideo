/** 我的页（按 v1 效果图）：登录态展示 + 退出登录 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { clearVideoCacheAsync, getCurrentVideoCacheSize } from 'expo-video';
import { useAuth } from '@/stores/auth';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MeScreen() {
  const { status, user, logout } = useAuth();
  const [cacheSize, setCacheSize] = useState<string>('…');
  const [loggingOut, setLoggingOut] = useState(false);

  const loggedIn = status === 'logged-in';
  const nickname = user?.nickname ?? '游客';
  const douyinId = user?.unique_id || user?.short_id || '未登录';
  const avatarChar = (user?.nickname || '游').slice(0, 1);

  const refreshCacheSize = useCallback(async () => {
    try {
      const size = await getCurrentVideoCacheSize();
      setCacheSize(formatBytes(size));
    } catch {
      setCacheSize('未知');
    }
  }, []);

  useEffect(() => {
    refreshCacheSize();
  }, [refreshCacheSize]);

  const handleClearCache = useCallback(async () => {
    try {
      await clearVideoCacheAsync();
      await refreshCacheSize();
      ToastAndroid.show('缓存已清理', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('清理失败', ToastAndroid.SHORT);
    }
  }, [refreshCacheSize]);

  const handleAbout = useCallback(() => {
    Alert.alert('关于 DyVideo', 'DyVideo v1.0.0\n仅自用的第三方抖音客户端\n数据来自抖音网页版公开接口');
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('退出登录', '将清除本机全部登录态（WebView 会话 + 本地存储），确定吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await logout();
          setLoggingOut(false);
          ToastAndroid.show('已退出登录', ToastAndroid.SHORT);
          router.back();
        },
      },
    ]);
  }, [logout]);

  return (
    <View style={styles.container}>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>‹ 返回</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{avatarChar}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{nickname}</Text>
          <Text style={styles.uid}>抖音号：{douyinId}</Text>
        </View>
        {loggedIn ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>已登录</Text>
          </View>
        ) : (
          <Pressable style={styles.loginBtn} onPress={() => router.push('/login')}>
            <Text style={styles.loginBtnText}>去登录</Text>
          </Pressable>
        )}
      </View>

      <Pressable style={[styles.row, styles.dim]} onPress={() => ToastAndroid.show('我的收藏 v2 再做', ToastAndroid.SHORT)}>
        <Text style={styles.rowText}>我的收藏</Text>
        <Text style={styles.rowRight}>v2 ›</Text>
      </Pressable>
      <Pressable style={[styles.row, styles.dim]} onPress={() => ToastAndroid.show('观看历史 v2 再做', ToastAndroid.SHORT)}>
        <Text style={styles.rowText}>观看历史</Text>
        <Text style={styles.rowRight}>v2 ›</Text>
      </Pressable>
      <Pressable style={styles.row} onPress={handleClearCache}>
        <Text style={styles.rowText}>清理缓存</Text>
        <Text style={styles.rowRight}>{cacheSize} ›</Text>
      </Pressable>
      <Pressable style={styles.row} onPress={handleAbout}>
        <Text style={styles.rowText}>关于 DyVideo</Text>
        <Text style={styles.rowRight}>v1.0.0 ›</Text>
      </Pressable>

      {loggedIn && (
        <Pressable style={styles.logoutBtn} onPress={handleLogout} disabled={loggingOut}>
          {loggingOut ? (
            <ActivityIndicator size="small" color="#fe2c55" />
          ) : (
            <Text style={styles.logoutText}>退出登录</Text>
          )}
        </Pressable>
      )}

      <Text style={styles.foot}>仅自用 · 不公开发布{'\n'}退出登录将清除本机全部登录态</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014', paddingHorizontal: 18, paddingTop: 56 },
  backBtn: { paddingVertical: 8, marginBottom: 8, alignSelf: 'flex-start' },
  backText: { color: '#888', fontSize: 15 },
  card: {
    backgroundColor: '#1b1b20',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  uid: { fontSize: 12, color: '#777' },
  badge: {
    backgroundColor: '#1f3d2b',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  badgeText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  loginBtn: {
    backgroundColor: '#fe2c55',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  loginBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  row: {
    backgroundColor: '#1b1b20',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dim: { opacity: 0.45 },
  rowText: { fontSize: 14, color: '#ddd' },
  rowRight: { color: '#666', fontSize: 13 },
  logoutBtn: {
    marginTop: 22,
    backgroundColor: '#1b1b20',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
  },
  logoutText: { fontSize: 14, color: '#fe2c55', fontWeight: '600' },
  foot: {
    position: 'absolute',
    bottom: 26,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 11,
    color: '#555',
    lineHeight: 20,
  },
});
