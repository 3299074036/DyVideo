/**
 * 推荐流主屏：竖屏翻页播放（按 v1 效果图）
 *
 * 架构（2026-10-08 重构：真浏览器拦截）：
 * - 不再由 App 自己算 a_bogus 调 feed 接口（纯 HTTP 路线已被 Argus WAF 封杀）
 * - 隐藏 WebView 加载抖音首页，注入 JS 拦截页面自己的 /aweme/v1/web/tab/feed/ 返回
 * - 拦截到的 play_addr 是页面会话生成的，同会话 WebView 播放不 403
 * - 首屏补救：hook 就绪 5 秒还没抓到数据，就在页面上下文里直接调一次 feed 接口
 * - 翻页：同理，让页面自己发下一页请求，拦截器抓返回后追加
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  ViewToken,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { router } from 'expo-router';
import VideoCard from '@/components/VideoCard';
import FeedInterceptor, {
  ApiHit,
  DetailResult,
  InterceptedFeed,
  PageState,
  RefreshPlayUrlResult,
  RescueResult,
  buildDetailRequestJS,
  buildFeedRequestJS,
} from '@/components/FeedInterceptor';
import { useAuth } from '@/stores/auth';
import {
  Aweme,
  isPlayableVideo,
} from '@/services/douyin';

const { height: SCREEN_H } = Dimensions.get('window');

function toast(msg: string) {
  ToastAndroid.show(msg, ToastAndroid.SHORT);
}

interface FeedResponse {
  status_code: number;
  status_msg?: string;
  aweme_list?: Aweme[];
  has_more?: number;
}

/** 从拦截到的 JSON 文本解析出视频列表 */
function parseFeedBody(body: string): Aweme[] {
  try {
    const data: FeedResponse = JSON.parse(body);
    if (data.status_code !== 0) {
      if (__DEV__) console.log('[Feed] status_code=', data.status_code, data.status_msg);
      return [];
    }
    return (data.aweme_list ?? []).filter(isPlayableVideo);
  } catch {
    return [];
  }
}

export default function FeedScreen() {
  const { status: authStatus } = useAuth();
  const [items, setItems] = useState<Aweme[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hookReady, setHookReady] = useState(false);
  // 诊断（release 也显示在错误页上）：定位"抓不到数据"卡在哪一步
  const [diagPage, setDiagPage] = useState('');
  const [diagApiHits, setDiagApiHits] = useState(0);
  const [diagApiUrls, setDiagApiUrls] = useState<string[]>([]);
  const [diagRescue, setDiagRescue] = useState('');
  const [diagRescueDetail, setDiagRescueDetail] = useState('');
  const [diagLastFeed, setDiagLastFeed] = useState('');

  const webviewRef = useRef<React.ElementRef<typeof WebView>>(null);
  const refreshIndex = useRef(1);
  const seenIds = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);
  const firstLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotFirstFeed = useRef(false);

  // 收到拦截到的 feed 响应
  const handleFeed = useCallback((feed: InterceptedFeed) => {
    const videos = parseFeedBody(feed.body);
    if (videos.length === 0) {
      // 诊断：收到响应但解析出 0 条（接口报错/非 JSON），记下来以便定位
      try {
        const d = JSON.parse(feed.body);
        setDiagLastFeed(`响应0条 status=${d.status_code} ${String(d.status_msg || '').slice(0, 30)}`);
      } catch {
        setDiagLastFeed('响应非 JSON');
      }
      return;
    }

    gotFirstFeed.current = true;
    if (rescueTimer.current) {
      clearTimeout(rescueTimer.current);
      rescueTimer.current = null;
    }
    if (firstLoadTimer.current) {
      clearTimeout(firstLoadTimer.current);
      firstLoadTimer.current = null;
    }

    setItems((prev) => {
      const fresh = videos.filter((v) => !seenIds.current.has(v.aweme_id));
      fresh.forEach((v) => seenIds.current.add(v.aweme_id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
    setLoading(false);
    setError(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    refreshIndex.current += 1;
  }, []);

  const handleHookReady = useCallback(() => {
    setHookReady(true);
    // 补救：5 秒后还没抓到首屏数据，就在页面上下文里直接调一次 feed 接口
    //（RN 里签好 a_bogus，页面带 Cookie 发起；注入的裸 fetch 不经过页面签名逻辑）
    if (rescueTimer.current) clearTimeout(rescueTimer.current);
    rescueTimer.current = setTimeout(() => {
      if (!gotFirstFeed.current) {
        if (__DEV__) console.log('[Feed] hook 就绪但无数据，主动触发页面请求');
        setDiagRescue('补救请求已发出');
        webviewRef.current?.injectJavaScript(buildFeedRequestJS(refreshIndex.current));
      }
    }, 5000);
    // 兜底：15 秒还没数据就报错
    if (firstLoadTimer.current) clearTimeout(firstLoadTimer.current);
    firstLoadTimer.current = setTimeout(() => {
      if (!gotFirstFeed.current) {
        setLoading(false);
        setError('没抓到推荐流数据，请重试');
      }
    }, 15000);
  }, []);

  const handleApiHit = useCallback((hit: ApiHit) => {
    setDiagApiHits((n) => n + 1);
    setDiagApiUrls((prev) => [...prev.slice(-2), hit.url.slice(0, 90)]);
    if (__DEV__) console.log('[Feed] API_HIT:', hit.url);
  }, []);

  const handleRescueResult = useCallback((r: RescueResult) => {
    setDiagRescueDetail(`status=${r.status} ok=${r.ok ? 1 : 0} ${r.body.slice(0, 120)}`);
    if (__DEV__) console.log('[Feed] RESCUE_RESULT:', r.status, r.ok, r.body.slice(0, 80));
  }, []);

  const handlePageState = useCallback((state: PageState) => {
    setDiagPage(`${state.title} | ${state.url}`.slice(0, 100));
    if (__DEV__) console.log('[Feed] PAGE_STATE:', state.title, state.url);
  }, []);

  // 详情换链的等待者：reqId -> resolve（带诊断信息）
  const detailWaiters = useRef(new Map<string, (r: RefreshPlayUrlResult) => void>());

  const handleDetailResult = useCallback((r: DetailResult) => {
    const resolve = detailWaiters.current.get(r.reqId);
    if (!resolve) return;
    detailWaiters.current.delete(r.reqId);
    let aweme: Aweme | null = null;
    let diag = `detail status=${r.status} ok=${r.ok ? 1 : 0}`;
    try {
      const data = JSON.parse(r.body);
      if (data.status_code === 0 && data.aweme_detail) {
        aweme = data.aweme_detail as Aweme;
        diag = 'detail OK';
      } else {
        diag = `detail status_code=${data.status_code} ${String(data.status_msg || '').slice(0, 40)}`;
      }
    } catch {
      diag = `detail 非JSON: ${r.body.slice(0, 60)}`;
    }
    resolve({ aweme, diag });
  }, []);

  /**
   * 403 时用详情接口换一条新鲜 play_url（myfollows 策略）。
   * 页面上下文带 Cookie 调详情接口（不带 a_bogus），返回带新 play_addr 的 Aweme。
   * 17:06 真机验证过这条路能通。
   */
  const refreshPlayUrl = useCallback((awemeId: string): Promise<RefreshPlayUrlResult> => {
    return new Promise((resolve) => {
      const reqId = `d${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const timer = setTimeout(() => {
        detailWaiters.current.delete(reqId);
        resolve({ aweme: null, diag: 'detail 12s 超时' });
      }, 12000);
      detailWaiters.current.set(reqId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      webviewRef.current?.injectJavaScript(buildDetailRequestJS(reqId, awemeId));
    });
  }, []);

  // 登录态变化时重置
  useEffect(() => {
    if (authStatus === 'unknown') return;
    refreshIndex.current = 1;
    seenIds.current.clear();
    gotFirstFeed.current = false;
    setItems([]);
    setActiveIndex(0);
    setLoading(true);
    setError(null);
    setHookReady(false);
  }, [authStatus]);

  useEffect(() => {
    return () => {
      if (firstLoadTimer.current) clearTimeout(firstLoadTimer.current);
      if (rescueTimer.current) clearTimeout(rescueTimer.current);
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hookReady) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    webviewRef.current?.injectJavaScript(buildFeedRequestJS(refreshIndex.current));
    setTimeout(() => {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }, 8000);
  }, [hookReady]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const v = viewableItems[0];
      if (v?.index != null) {
        setActiveIndex(v.index);
        if (v.index >= items.length - 2) loadMore();
      }
    },
    [items.length, loadMore]
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  const handleAvatarPress = useCallback(() => {
    router.push(authStatus === 'logged-in' ? '/me' : '/login');
  }, [authStatus]);

  const handleV2Press = useCallback((label: string) => {
    toast(`${label} v2 再做`);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setItems([]);
    seenIds.current.clear();
    gotFirstFeed.current = false;
    refreshIndex.current = 1;
    setDiagPage('');
    setDiagApiHits(0);
    setDiagApiUrls([]);
    setDiagRescue('');
    setDiagRescueDetail('');
    setDiagLastFeed('');
    webviewRef.current?.reload();
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Aweme; index: number }) => (
      <VideoCard
        item={item}
        active={index === activeIndex}
        height={SCREEN_H}
        onAvatarPress={handleAvatarPress}
        onV2Press={handleV2Press}
        onRefreshPlayUrl={refreshPlayUrl}
      />
    ),
    [activeIndex, handleAvatarPress, handleV2Press, refreshPlayUrl]
  );

  const keyExtractor = useCallback((item: Aweme) => item.aweme_id, []);

  return (
    <View style={styles.container}>
      <FeedInterceptor
        key={authStatus}
        ref={webviewRef}
        onFeed={handleFeed}
        onReady={handleHookReady}
        onApiHit={handleApiHit}
        onPageState={handlePageState}
        onDetailResult={handleDetailResult}
        onRescueResult={handleRescueResult}
        debug
      />

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#fe2c55" />
          <Text style={styles.hint}>
            {hookReady ? '正在抓取推荐流…' : '正在建立会话…'}
          </Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
          <Text style={styles.diagText}>
            {`hook: ${hookReady ? '就绪' : '未就绪'}\n页面: ${diagPage || '未知'}\nAPI 请求数: ${diagApiHits}\n${diagApiUrls.map((u) => `· ${u}`).join('\n')}${diagApiUrls.length ? '\n' : ''}补救: ${diagRescue || '未发出'}${diagRescueDetail ? `\n补救详情: ${diagRescueDetail}` : ''}\n最近响应: ${diagLastFeed || '无'}`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({
            length: SCREEN_H,
            offset: SCREEN_H * index,
            index,
          })}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color="#888" />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  hint: { color: '#888', fontSize: 13 },
  errorText: { color: '#aaa', fontSize: 14, paddingHorizontal: 32, textAlign: 'center' },
  diagText: { color: '#555', fontSize: 11, paddingHorizontal: 32, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#fe2c55',
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 10,
  },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  footer: { height: SCREEN_H, alignItems: 'center', justifyContent: 'center' },
});
