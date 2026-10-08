/**
 * 登录态管理：原生 Cookie jar 为准 + SecureStore 存用户快照
 *
 * - 登录成功 = jar 里出现 sessionid（WebView 扫码后由 RN 层轮询确认）
 * - 退出登录 = 先清原生 Cookie jar，再清本地存储（顺序不能反）
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  DyUser,
  clearNativeCookies,
  fetchSelfProfile,
  getCookieHeader,
  hasLoginSession,
} from '../services/douyin';

export type AuthStatus = 'unknown' | 'guest' | 'logged-in';

interface AuthContextValue {
  status: AuthStatus;
  user: DyUser | null;
  /** 应用启动 / 从后台返回时调用：以 Cookie jar 为准恢复登录态 */
  restore: () => Promise<void>;
  /** WebView 确认登录成功后调用：拉取用户信息并持久化 */
  completeLogin: () => Promise<boolean>;
  /** 退出登录：清 jar + 清存储 */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = 'dyvideo.auth.user.v1';

async function loadCachedUser(): Promise<DyUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as DyUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('unknown');
  const [user, setUser] = useState<DyUser | null>(null);

  const restore = useCallback(async () => {
    const loggedIn = await hasLoginSession();
    if (!loggedIn) {
      setStatus('guest');
      setUser(null);
      return;
    }
    // 有登录态：优先拉取最新资料，失败则用缓存快照兜底
    try {
      const cookie = await getCookieHeader();
      const profile = await fetchSelfProfile(cookie);
      if (profile) {
        setUser(profile);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(profile));
      } else {
        setUser(await loadCachedUser());
      }
    } catch {
      setUser(await loadCachedUser());
    }
    setStatus('logged-in');
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  const completeLogin = useCallback(async (): Promise<boolean> => {
    const loggedIn = await hasLoginSession();
    if (!loggedIn) return false;
    try {
      const cookie = await getCookieHeader();
      const profile = await fetchSelfProfile(cookie);
      if (profile) {
        setUser(profile);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(profile));
      }
    } catch {
      /* 资料拉取失败不阻塞登录成功 */
    }
    setStatus('logged-in');
    return true;
  }, []);

  const logout = useCallback(async () => {
    // 顺序：先清原生 Cookie jar（否则官方页仍保持登录），再清本地存储
    await clearNativeCookies();
    try {
      await SecureStore.deleteItemAsync(USER_KEY);
    } catch {
      /* best-effort */
    }
    setUser(null);
    setStatus('guest');
  }, []);

  const value = useMemo(
    () => ({ status, user, restore, completeLogin, logout }),
    [status, user, restore, completeLogin, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
