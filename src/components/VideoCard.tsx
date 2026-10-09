/**
 * 单条视频卡片：播放器 + 右侧操作栏 + 底部信息（按 v1 效果图）
 * v1：点赞/评论/收藏/关注置灰标 v2，不可点；分享走系统面板；双击仅本地爱心动画
 *
 * 播放方案（2026-10-08：远端直播流，边下边播）：
 * - play_url 来自隐藏 WebView 拦截到的页面自身接口返回
 * - expo-video 直接播远端 URL，请求头只带 Referer + UA
 *   （myfollows 已验证 play_addr 仅需 Referer；跨域 Cookie 会被 WAF 403）
 * - 不再下载整文件：秒开、不占磁盘；ExoPlayer 自己处理缓冲与 Range seek
 * - 播放失败（多为 403）时先换 url_list 里下一个 CDN 地址重试（不调接口），
 *   都不行再用详情接口换新鲜 play_url，player.replace() 重试（myfollows 策略）
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  Share,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  Aweme,
  DOUYIN_ORIGIN,
  DOUYIN_UA,
  pickPlayUrl,
  pickPlayUrls,
  reportHostResult,
} from '@/services/douyin';
import type { RefreshPlayUrlResult } from '@/components/FeedInterceptor';

export function formatCount(n: number | undefined): string {
  if (!n || n <= 0) return '0';
  if (n >= 10000) {
    const w = n / 10000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1).replace(/\.0$/, '')}w`;
  }
  return `${n}`;
}

interface Props {
  item: Aweme;
  active: boolean;
  height: number;
  onAvatarPress: () => void;
  onV2Press: (label: string) => void;
  /** 403 时换新鲜 play_url（返回带新 play_addr 的结果，失败时 diag 说明原因） */
  onRefreshPlayUrl: (awemeId: string) => Promise<RefreshPlayUrlResult>;
  /** v2 互动：点赞/评论/收藏/关注 */
  onLike: (awemeId: string, like: boolean) => Promise<boolean>;
  onComment: (awemeId: string) => void;
  onCollect: (awemeId: string, collect: boolean) => Promise<boolean>;
  onFollow: (awemeId: string, follow: boolean) => Promise<boolean>;
}

/** 远端播放请求头：只带 Referer + UA（跨域 Cookie 会被 WAF 403） */
const STREAM_HEADERS = {
  Referer: `${DOUYIN_ORIGIN}/`,
  'User-Agent': DOUYIN_UA,
};

interface StreamProps extends Props {
  playUrls: string[];
}

function StreamingVideoCard({ item, playUrls, active, height, onAvatarPress, onV2Press, onRefreshPlayUrl, onLike, onComment, onCollect, onFollow }: StreamProps) {
  const [playError, setPlayError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [hasReady, setHasReady] = useState(false);
  // v2 互动状态（乐观更新）
  const [liked, setLiked] = useState(false);
  const [collected, setCollected] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [diggCount, setDiggCount] = useState(item.statistics.digg_count);
  const [collectCount, setCollectCount] = useState(item.statistics.collect_count);
  // 当前在试第几个 CDN 地址（url_list 里一般有 3 个，换着试）
  const [urlIndex, setUrlIndex] = useState(0);
  const refreshedRef = useRef(false);
  const mountedRef = useRef(true);
  const playUrl = playUrls[urlIndex];

  // 远端直播流：player 只在拿到真实 playUrl 后创建，永不传空 URI
  //（空 URI 会让 ExoPlayer 报 ENOENT 假错误——之前"有的视频报错"就是这么来的）
  const player = useVideoPlayer(
    { uri: playUrl, headers: STREAM_HEADERS },
    (p) => {
      p.loop = true;
      p.timeUpdateEventInterval = 0.5;
    }
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 播放状态监听：失败时先换列表里下一个 CDN 地址试（不调接口），
  // 都不行再走详情换链；就绪后清掉错误提示
  useEffect(() => {
    const sub = player.addListener('statusChange', (ev) => {
      if (ev.status === 'error') {
        const msg = ev.error?.message ?? 'unknown';
        // 给当前 CDN 记一笔失败，下次排序时沉底
        reportHostResult(playUrl, false);
        // 还有备用地址：直接换下一个试，不用等详情接口
        if (urlIndex < playUrls.length - 1) {
          const next = urlIndex + 1;
          setUrlIndex(next);
          setPlayError('换节点重试…');
          setHasReady(false);
          player.replace({ uri: playUrls[next], headers: STREAM_HEADERS });
          return;
        }
        // 列表里的地址都试过了，走详情换链（myfollows 策略）
        if (!refreshedRef.current) {
          refreshedRef.current = true;
          setPlayError('链接过期，正在换链…');
          onRefreshPlayUrl(item.aweme_id)
            .then(({ aweme: fresh, diag }) => {
              if (!mountedRef.current) return;
              const freshUrl = fresh ? pickPlayUrl(fresh) : null;
              if (freshUrl && freshUrl !== playUrl) {
                setPlayError(null);
                setHasReady(false);
                player.replace({ uri: freshUrl, headers: STREAM_HEADERS });
              } else {
                // 诊断版：把详情接口的实际返回直接显示出来
                setPlayError(`换链失败：${diag}`);
              }
            })
            .catch(() => {
              if (mountedRef.current) setPlayError('换链失败：请求异常');
            });
        } else {
          setPlayError(`播放失败 (${msg})`);
        }
      } else if (ev.status === 'readyToPlay') {
        setHasReady(true);
        setPlayError(null);
        // 给当前 CDN 记一笔成功，下次优先用它
        reportHostResult(playUrl, true);
      }
    });
    return () => sub.remove();
  }, [player, item.aweme_id, onRefreshPlayUrl, playUrl, playUrls, urlIndex]);

  // 播放控制：当前卡片且用户未暂停 → 播；否则暂停
  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  // 切走再回来时，恢复"未手动暂停"状态
  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  // 播放进度条
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const d = player.duration;
      if (d > 0) setProgress(Math.min(1, player.currentTime / d));
    }, 500);
    return () => clearInterval(t);
  }, [active, player]);

  const discAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(discAnim, {
        toValue: 1,
        duration: 6000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    if (active && !paused) loop.start();
    else loop.stop();
    return () => loop.stop();
  }, [active, paused, discAnim]);

  const [heartKey, setHeartKey] = useState(0);
  const heartAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireHeart = () => {
    setHeartKey((k) => k + 1);
    heartAnim.setValue(0);
    Animated.timing(heartAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      fireHeart();
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      setPaused((p) => !p);
    }, 300);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `https://www.douyin.com/video/${item.aweme_id}`,
      });
    } catch {
      /* 用户取消 */
    }
  };

  // v2 互动：乐观更新 + 调桥，失败回滚
  const handleLike = async () => {
    const next = !liked;
    setLiked(next);
    setDiggCount((c) => c + (next ? 1 : -1));
    fireHeart();
    const ok = await onLike(item.aweme_id, next);
    if (!ok) {
      setLiked(!next);
      setDiggCount((c) => c + (next ? -1 : 1));
    }
  };

  const handleCollect = async () => {
    const next = !collected;
    setCollected(next);
    setCollectCount((c) => c + (next ? 1 : -1));
    const ok = await onCollect(item.aweme_id, next);
    if (!ok) {
      setCollected(!next);
      setCollectCount((c) => c + (next ? -1 : 1));
    }
  };

  const handleFollow = async () => {
    const next = !followed;
    setFollowed(next);
    const ok = await onFollow(item.aweme_id, next);
    if (!ok) setFollowed(!next);
  };

  const discSpin = discAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const heartScale = heartAnim.interpolate({
    inputRange: [0, 0.25, 0.6, 1],
    outputRange: [0.6, 1.25, 1, 0.9],
  });
  const heartOpacity = heartAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 1, 0],
  });

  const author = item.author;
  const stats = item.statistics;
  const avatarChar = (author.nickname || '?').slice(0, 1);
  const musicText = item.music
    ? `♪ ${item.music.title} - ${item.music.author}`
    : '♪ 原创音乐';

  // 诊断小字：视频 id + CDN 域名，截图即可定位
  const urlHost = (() => {
    try {
      return new URL(playUrl).host;
    } catch {
      return '';
    }
  })();
  const diagLine = `id: ${item.aweme_id}${urlHost ? ` · ${urlHost}` : ''}`;

  return (
    <View style={[styles.container, { height }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      {!hasReady && !playError && (
        <View style={[StyleSheet.absoluteFill, styles.noVideo]} pointerEvents="none">
          <ActivityIndicator size="large" color="#fe2c55" />
          <Text style={styles.noVideoText}>正在加载视频…</Text>
          <Text style={styles.diagText}>{diagLine}</Text>
        </View>
      )}
      {playError && (
        <View style={[StyleSheet.absoluteFill, styles.noVideo]} pointerEvents="none">
          <Text style={styles.noVideoText}>{playError}</Text>
          <Text style={styles.diagText}>{diagLine}</Text>
        </View>
      )}
      {/* 透明点击层：盖在视频上方收单击/双击。
          之前把 Pressable 包在视频外面，但 Android 上视频走 SurfaceView 独立图层，
          触摸事件冒泡不到 RN 的 Pressable，导致单击没反应。这一层隐形，不影响界面。 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} />

      {paused && active && (
        <View style={styles.pausedBadge} pointerEvents="none">
          <Text style={styles.pausedIcon}>▶</Text>
        </View>
      )}

      {heartKey > 0 && (
        <Animated.View
          key={heartKey}
          pointerEvents="none"
          style={[
            styles.heartWrap,
            { opacity: heartOpacity, transform: [{ scale: heartScale }] },
          ]}
        >
          <Text style={styles.heart}>❤</Text>
        </Animated.View>
      )}

      {active && (
        <View style={styles.progressBar} pointerEvents="none">
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topTabs}>
          <Pressable onPress={() => onV2Press('关注')}>
            <Text style={styles.topTabDim}>关注</Text>
          </Pressable>
          <Text style={styles.topTab}>推荐</Text>
        </View>
        <Pressable style={styles.searchBtn} onPress={() => onV2Press('搜索')}>
          <Text style={styles.searchIcon}>🔍</Text>
        </Pressable>
      </View>

      <View style={styles.rail} pointerEvents="box-none">
        <Pressable style={styles.avatarWrap} onPress={onAvatarPress}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarChar}</Text>
          </View>
          <Pressable style={[styles.followPlus, followed && styles.followDone]} onPress={handleFollow}>
            <Text style={styles.followPlusText}>{followed ? '✓' : '+'}</Text>
          </Pressable>
        </Pressable>
        <Pressable style={styles.railItem} onPress={handleLike}>
          <Text style={[styles.railIcon, liked && styles.likedIcon]}>❤</Text>
          <Text style={styles.railText}>{formatCount(diggCount)}</Text>
        </Pressable>
        <Pressable style={styles.railItem} onPress={() => onComment(item.aweme_id)}>
          <Text style={styles.railIcon}>💬</Text>
          <Text style={styles.railText}>{formatCount(stats.comment_count)}</Text>
        </Pressable>
        <Pressable style={styles.railItem} onPress={handleCollect}>
          <Text style={[styles.railIcon, collected && styles.likedIcon]}>⭐</Text>
          <Text style={styles.railText}>{formatCount(collectCount)}</Text>
        </Pressable>
        <Pressable style={styles.railItem} onPress={handleShare}>
          <Text style={styles.railIcon}>↗</Text>
          <Text style={styles.railText}>分享</Text>
        </Pressable>
        <Animated.View style={[styles.disc, { transform: [{ rotate: discSpin }] }]}>
          <Text style={styles.discText}>♪</Text>
        </Animated.View>
      </View>

      <View style={styles.bottomInfo} pointerEvents="box-none">
        <Text style={styles.nickname}>@{author.nickname}</Text>
        <Text style={styles.desc} numberOfLines={2}>
          {item.desc}
        </Text>
        <Text style={styles.music} numberOfLines={1}>
          {musicText}
        </Text>
      </View>
    </View>
  );
}

function VideoCardInner(props: Props) {
  const playUrls = pickPlayUrls(props.item);
  // 列表已用 isPlayableVideo 过滤，这里只是兜底：无地址就不创建播放器
  if (playUrls.length === 0) {
    return (
      <View style={[styles.container, { height: props.height }, styles.noVideo]}>
        <Text style={styles.noVideoText}>暂无可播地址</Text>
        <Text style={styles.diagText}>id: {props.item.aweme_id}</Text>
      </View>
    );
  }
  return <StreamingVideoCard {...props} playUrls={playUrls} />;
}

export default memo(VideoCardInner);

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
  noVideo: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', gap: 12 },
  noVideoText: { color: '#666', fontSize: 13 },
  diagText: { color: '#444', fontSize: 10, paddingHorizontal: 24, textAlign: 'center' },
  pausedBadge: {
    position: 'absolute',
    top: '45%',
    left: '45%',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pausedIcon: { color: '#fff', fontSize: 24 },
  heartWrap: {
    position: 'absolute',
    top: '40%',
    left: '40%',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heart: { fontSize: 90, color: '#fe2c55' },
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressFill: { height: 2, backgroundColor: '#fff' },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTabs: { flexDirection: 'row', gap: 20 },
  topTab: { color: '#fff', fontSize: 17, fontWeight: '700' },
  topTabDim: { color: 'rgba(255,255,255,0.6)', fontSize: 17 },
  searchBtn: { position: 'absolute', right: 16 },
  searchIcon: { fontSize: 22 },
  rail: {
    position: 'absolute',
    right: 8,
    bottom: 100,
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: { alignItems: 'center', marginBottom: 8 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  avatarText: { color: '#fff', fontSize: 20 },
  followPlus: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fe2c55',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -10,
  },
  followPlusText: { color: '#fff', fontSize: 14, lineHeight: 16 },
  followDone: { backgroundColor: '#3a3a3a' },
  railItem: { alignItems: 'center' },
  railIcon: { fontSize: 30 },
  likedIcon: { color: '#fe2c55' },
  railText: { color: '#fff', fontSize: 12, marginTop: 2 },
  disc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 8,
    borderColor: '#111',
  },
  discText: { color: '#fff', fontSize: 16 },
  bottomInfo: { position: 'absolute', left: 12, right: 80, bottom: 24 },
  nickname: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  desc: { color: '#fff', fontSize: 14, marginBottom: 6 },
  music: { color: '#fff', fontSize: 13 },
});
