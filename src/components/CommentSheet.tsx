/**
 * CommentSheet：评论底部弹窗
 * - 上滑出现，显示评论列表（分页加载）
 * - 底部发表框，发送走 ActionBridge（页面上下文，带签名）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import {
  DyComment,
  formatCount,
} from '@/services/douyin';
import type { ActionBridgeRef } from '@/components/ActionBridge';

type Props = {
  visible: boolean;
  awemeId: string;
  commentCount: number;
  onClose: () => void;
  bridgeRef: React.RefObject<ActionBridgeRef | null>;
};

function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000 - ts);
  if (d < 60) return '刚刚';
  if (d < 3600) return `${Math.floor(d / 60)}分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)}小时前`;
  return `${Math.floor(d / 86400)}天前`;
}

function CommentItem({ c }: { c: DyComment }) {
  const ch = (c.user.nickname || '匿').slice(0, 1);
  return (
    <View style={styles.item}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{ch}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{c.user.nickname}</Text>
        <Text style={styles.text}>{c.text}</Text>
        <Text style={styles.meta}>
          {timeAgo(c.create_time)} · ❤️ {formatCount(c.digg_count)}
          {c.reply_count > 0 ? ` · ${c.reply_count}回复` : ''}
        </Text>
      </View>
    </View>
  );
}

export default function CommentSheet({ visible, awemeId, commentCount, onClose, bridgeRef }: Props) {
  const [comments, setComments] = useState<DyComment[]>([]);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const cursorRef = useRef(0);

  const load = useCallback(async (reset: boolean) => {
    if (!awemeId) return;
    if (reset) {
      setLoading(true);
      setError('');
      cursorRef.current = 0;
    } else {
      if (loadingMore || !hasMore) return;
      setLoadingMore(true);
    }
    try {
      if (!bridgeRef.current) throw new Error('操作桥未就绪');
      const r = await bridgeRef.current.fetchComments(awemeId);
      if (!r.ok) throw new Error(r.msg || '评论加载失败');
      const list: DyComment[] = (r.comments ?? []).map((cm: any, i: number) => ({
        cid: String(cm.cid ?? `dom-${i}`),
        text: String(cm.text ?? ''),
        create_time: Number(cm.create_time ?? Date.now() / 1000),
        digg_count: Number(cm.digg_count ?? 0),
        reply_count: Number(cm.reply_count ?? 0),
        user: {
          uid: String(cm.user?.uid ?? ''),
          nickname: String(cm.user?.nickname ?? '用户'),
          avatar_thumb: cm.user?.avatar_thumb,
        },
      }));
      // DOM 版暂不支持翻页
      setHasMore(false);
      setComments((prev) => (reset ? list : [...prev, ...list]));
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [awemeId, hasMore, loadingMore, bridgeRef]);

  useEffect(() => {
    if (visible && awemeId) {
      setComments([]);
      setHasMore(true);
      load(true);
    }
  }, [visible, awemeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (!bridgeRef.current) throw new Error('操作桥未就绪');
      const r = await bridgeRef.current.publishComment(awemeId, text);
      if (r.ok) {
        setInput('');
        ToastAndroid.show('评论已发送', ToastAndroid.SHORT);
        load(true);
      } else {
        ToastAndroid.show(`发送失败: ${r.msg}`, ToastAndroid.SHORT);
      }
    } finally {
      setSending(false);
    }
  }, [input, sending, awemeId, bridgeRef, load]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheet}
      >
        <View style={styles.header}>
          <Text style={styles.title}>评论 {formatCount(commentCount)}</Text>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#fe2c55" />
            <Text style={styles.hint}>加载评论中…</Text>
          </View>
        ) : error && comments.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.errText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => load(true)}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
            <Text style={styles.diag}>视频ID: {awemeId.slice(0, 12)}…{'\n'}评论接口无需签名，检查网络</Text>
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(c) => c.cid}
            renderItem={({ item }) => <CommentItem c={item} />}
            onEndReached={() => load(false)}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator color="#888" style={{ padding: 16 }} /> :
              !hasMore && comments.length > 0 ? <Text style={styles.end}>— 到底了 —</Text> : null
            }
            ListEmptyComponent={
              !loading ? <Text style={styles.empty}>还没有评论，来抢沙发</Text> : null
            }
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="写下你的评论…"
            placeholderTextColor="#666"
            maxLength={140}
            editable={!sending}
          />
          <Pressable
            style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendText}>发送</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '68%',
    backgroundColor: '#16161d',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a33',
  },
  title: { fontSize: 15, fontWeight: '700', color: '#fff' },
  close: { position: 'absolute', right: 8, padding: 10 },
  closeText: { color: '#888', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { color: '#888', fontSize: 13 },
  errText: { color: '#aaa', fontSize: 14 },
  diag: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  retry: { backgroundColor: '#fe2c55', borderRadius: 18, paddingHorizontal: 24, paddingVertical: 8, marginTop: 8 },
  retryText: { color: '#fff', fontSize: 14 },
  empty: { color: '#666', fontSize: 13, textAlign: 'center', marginTop: 40 },
  end: { color: '#555', fontSize: 12, textAlign: 'center', padding: 16 },
  item: { flexDirection: 'row', padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e26' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#2c2c38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#aaa', fontSize: 14 },
  body: { flex: 1 },
  name: { color: '#999', fontSize: 12 },
  text: { color: '#eee', fontSize: 14, marginTop: 3, lineHeight: 20 },
  meta: { color: '#666', fontSize: 11, marginTop: 5 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a2a33',
    backgroundColor: '#16161d',
  },
  input: {
    flex: 1,
    backgroundColor: '#26262f',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: '#fff',
    fontSize: 14,
  },
  send: { backgroundColor: '#fe2c55', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 9 },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
