import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';

const API = 'http://localhost:3000';
const DEFAULT_LEVEL = '\u4e2d\u5b66';
const LEVEL_OPTIONS = [
  { value: '\u5c0f\u5b66', label: '\u5c0f\u5b66' },
  { value: '\u4e2d\u5b66', label: '\u4e2d\u5b66' },
  { value: '\u9ad8\u4e2d', label: '\u9ad8\u4e2d' },
  { value: 'CET4_6_TOEFL', label: 'CET/TOEFL' },
];

export default function App() {
  const [screen, setScreen] = useState('select');
  const [user, setUser] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [testId, setTestId] = useState(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [allStats, setAllStats] = useState([]);
  const [newWord, setNewWord] = useState('');
  const [message, setMessage] = useState('');
  const [multiWords, setMultiWords] = useState([]);
  const [multiSelections, setMultiSelections] = useState([]);
  const [editStatus, setEditStatus] = useState('');
  const [editWord, setEditWord] = useState(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [editCnMeaning, setEditCnMeaning] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editDistractors, setEditDistractors] = useState('');
  const [searchWord, setSearchWord] = useState('');
  const [learningSettings, setLearningSettings] = useState(null);
  const [cacheStatus, setCacheStatus] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(DEFAULT_LEVEL);

  const searchWordAction = async () => {
    const w = searchWord.trim().toLowerCase();
    if (!w) { setMessage('请输入要查询的单词'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/word?userId=${user}&word=${encodeURIComponent(w)}`);
      const data = await res.json();
      if (data.word) {
        setEditWord(data.word);
        setEditMeaning(data.meaning || '');
        setEditCnMeaning(data.cnMeaning || '');
        setEditContext(data.context || '');
        setEditDistractors(data.distractors || '');
        setEditStatus(data.status || 'Pending');
        setScreen('editWord');
      } else {
        setMessage('单词不存在，可以直接录入');
        setNewWord(w);
        setScreen('addWord');
      }
    } catch (e) { setMessage('查询失败'); }
    setLoading(false);
  };

  const saveWord = async () => {
    if (!editWord) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/word`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user,
          word: editWord,
          meaning: editMeaning,
          cnMeaning: editCnMeaning,
          context: editContext,
          distractors: editDistractors,
          status: editStatus
        })
      });
      setMessage('保存成功');
      setEditWord(null);
      setScreen('actions');
    } catch (e) { setMessage('保存失败'); }
    setLoading(false);
  };

  const removeWord = async () => {
    if (!editWord) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/word?userId=${user}&word=${encodeURIComponent(editWord)}`, { method: 'DELETE' });
      setMessage(`已删除 ${editWord}`);
      setEditWord(null);
      setScreen('actions');
    } catch (e) { setMessage('删除失败'); }
    setLoading(false);
  };

  const chooseUser = async (u) => {
    setUser(u);
    setScreen('actions');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/stats/${u}`);
      const data = await res.json();
      setStats(data);
    } catch (e) { console.log('获取统计失败', e); }
    setLoading(false);
  };

  const startTest = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, level: learningSettings?.learningLevel || selectedLevel || DEFAULT_LEVEL })
      });
      const data = await res.json();
      if (data.error) { setMessage(data.error); setLoading(false); return; }
      setQuiz(data.questions);
      setTestId(data.testId);
      setCurrent(0);
      setAnswers({});
      setResults(null);
      setScreen('quiz');
    } catch (e) { setMessage('无法连接服务器'); }
    setLoading(false);
  };

  const submitTest = async () => {
    if (!testId) return;
    setLoading(true);
    const ans = quiz.map((_, i) => answers[i] !== undefined ? answers[i] : null);
    try {
      const res = await fetch(`${API}/api/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, testId, answers: ans })
      });
      const data = await res.json();
      setResults(data);
      setScreen('results');
    } catch { setMessage('提交失败'); }
    setLoading(false);
  };

  const submitWord = async () => {
    const w = newWord.trim();
    if (!w) { setMessage('请输入单词'); return; }
    const words = w.split(/[,，]/).map(x => x.trim()).filter(x => x);
    if (words.length === 0) { setMessage('请输入至少一个单词'); return; }
    for (const word of words) {
      if (!/^[a-zA-Z]+$/.test(word)) { setMessage(`单词 "${word}" 包含非法字符`); return; }
    }
    setLoading(true);
    setMessage('提交中...');
    try {
      const res = await fetch(`${API}/api/admin/addWords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUser: user, words })
      });
      const data = await res.json();
      if (data.error) { setMessage(data.error); }
      else {
        setMultiWords(words);
        setMultiSelections(words.map(() => false));
        setScreen('multi');
      }
    } catch (e) { setMessage('提交失败: ' + e.message); }
    setLoading(false);
  };

  const confirmMulti = async () => {
    const selected = multiWords.filter((_, i) => multiSelections[i]);
    console.log('确认多义', selected);
    if (selected.length > 0) {
      setLoading(true);
      try {
        console.log('调用API');
        await fetch(`${API}/api/admin/updateMulti`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUser: user, words: selected })
        });
      } catch (e) { console.log('更新多义词失败', e); }
      setLoading(false);
    }
    setMessage(`已录入 ${multiWords.length} 个单词`);
    setNewWord('');
    setMultiWords([]);
    setScreen('addWord');
  };

  const showDashboard = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/stats`);
      const data = await res.json();
      setAllStats(data.stats || []);
      setScreen('dashboard');
    } catch { setAllStats([]); setScreen('dashboard'); }
    setLoading(false);
  };

  const loadLearningSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const settingsRes = await fetch(`${API}/api/admin/userSettings?userId=${encodeURIComponent(user)}`);
      const settingsData = await settingsRes.json();
      const statusRes = await fetch(`${API}/api/admin/questionCache/status?userId=${encodeURIComponent(user)}`);
      const statusData = await statusRes.json();
      const settings = settingsData.settings || {};
      setLearningSettings(settings);
      setCacheStatus(statusData.status || null);
      setSelectedLevel(settings.learningLevel || DEFAULT_LEVEL);
      setScreen('learningSettings');
    } catch (e) {
      setMessage('\u5b66\u4e60\u8bbe\u7f6e\u52a0\u8f7d\u5931\u8d25');
    }
    setLoading(false);
  };

  const saveLearningSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/userSettings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user, learningLevel: selectedLevel })
      });
      const data = await res.json();
      setLearningSettings(data.settings || learningSettings);
      setMessage(res.ok ? '\u5b66\u4e60\u96be\u5ea6\u5df2\u4fdd\u5b58' : '\u5b66\u4e60\u8bbe\u7f6e\u4fdd\u5b58\u5931\u8d25');
    } catch (e) {
      setMessage('\u5b66\u4e60\u8bbe\u7f6e\u4fdd\u5b58\u5931\u8d25');
    }
    setLoading(false);
  };

  const rebuildQuestionCache = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/questionCache/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user })
      });
      const data = await res.json();
      setCacheStatus(data.status || cacheStatus);
      setMessage(data.skipped ? '\u9898\u5e93\u8868\u672a\u914d\u7f6e\uff0c\u5df2\u8df3\u8fc7' : `\u9898\u5e93\u5df2\u91cd\u5efa ${data.count || 0} \u6761`);
    } catch (e) {
      setMessage('\u9898\u5e93\u91cd\u5efa\u5931\u8d25');
    }
    setLoading(false);
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#6200EE" /><Text>加载中...</Text></View>;

  if (screen === 'results' && results) return (
    <ScrollView style={s.container}>
      <Text style={s.bigTitle}>批改结果</Text>
      <Text style={s.score}>{results.correct} / {results.total}</Text>
      <Text style={s.accuracy}>{results.accuracy}</Text>
      {results.rewardSummary ? (
        <View style={s.rewardCard}>
          <Text style={s.rewardTitle}>动物花园奖励</Text>
          <Text>本次词晶: {results.rewardSummary.summary?.wordCrystalsEarned || 0}</Text>
          <Text>封存词晶: {results.rewardSummary.summary?.sealedCrystalsEarned || 0}</Text>
          <Text>已掌握释义: {results.rewardSummary.summary?.masteredMeaningCount || 0}</Text>
          {results.rewardSummary.summary?.smallMilestoneUnlocked ? <Text style={s.rewardGood}>小里程碑已解锁</Text> : null}
          {results.rewardSummary.summary?.bigMilestoneUnlocked ? <Text style={s.rewardGood}>大里程碑已解锁</Text> : null}
          {results.rewardSummary.openedHabitats?.length ? <Text>新区域: {results.rewardSummary.openedHabitats.join(', ')}</Text> : null}
          {results.rewardSummary.unlockedAnimals?.length ? <Text>新动物: {results.rewardSummary.unlockedAnimals.join(', ')}</Text> : null}
        </View>
      ) : null}
      {results.results?.map((r, i) => (
        <View key={i} style={[s.card, r.correct ? s.greenCard : s.redCard]}>
          <Text>第{i+1}题: {r.correct ? '✓ 正确' : `你的答案：${r.your || '未答'}；正确答案：${r.answer}`}</Text>
        </View>
      ))}
      <TouchableOpacity style={s.btn} onPress={() => { setQuiz(null); setResults(null); setScreen('actions'); }}>
        <Text style={s.btnText}>继续学习</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  if (screen === 'quiz' && quiz) {
    const q = quiz[current];
    const total = quiz.length;
    const typeName = q.type === 1 ? '语境填空' : q.type === 2 ? '英英释义' : q.type === 3 ? '中英释义' : '未知';
    return (
      <ScrollView style={s.container}>
        <Text style={s.title}>第 {current + 1} / {total} 题</Text>
        <Text style={s.typeLabel}>{typeName}</Text>
        <View style={s.card}>
          <Text style={s.context}>{q.context}</Text>
        </View>
        <Text style={s.hint}>选出正确的答案</Text>
        {q.options.map((opt, i) => (
          <TouchableOpacity key={i} style={[s.option, answers[current] === i && s.selected]} onPress={() => setAnswers(a => ({...a, [current]: i}))}>
            <Text style={s.optionText}>{opt}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.nav}>
          {current > 0 && <TouchableOpacity style={s.prevBtn} onPress={() => setCurrent(c => c - 1)}><Text style={s.navText}>上一题</Text></TouchableOpacity>}
          {current < total - 1 ? <TouchableOpacity style={s.nextBtn} onPress={() => setCurrent(c => c + 1)}><Text style={s.navText}>下一题</Text></TouchableOpacity> : <TouchableOpacity style={s.submitBtn} onPress={submitTest}><Text style={s.navText}>提交</Text></TouchableOpacity>}
        </View>
      </ScrollView>
    );
  }

  if (screen === 'multi') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>多义词确认</Text>
      <Text style={s.subtitle}>请勾选哪些是多义词（默认不勾选）：</Text>
      {multiWords.map((word, i) => (
        <View key={i} style={s.multiItem}>
          <TouchableOpacity style={s.checkbox} onPress={() => {
            const newSel = [...multiSelections];
            newSel[i] = !newSel[i];
            setMultiSelections(newSel);
          }}>
            {multiSelections[i] ? <Text style={s.checkmark}>✓</Text> : <Text style={s.checkEmpty}>-</Text>}
          </TouchableOpacity>
          <Text style={s.multiWord}>{word}</Text>
        </View>
      ))}
      <View style={s.btnRow}>
        <TouchableOpacity style={s.grayBtn} onPress={() => { setNewWord(''); setMultiWords([]); setScreen('addWord'); }}>
          <Text style={s.btnText}>跳过</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.greenBtn} onPress={confirmMulti}>
          <Text style={s.btnText}>确认</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  if (screen === 'editWord') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>编辑单词</Text>
      <Text style={s.bigText}>{editWord}</Text>
      <Text style={s.label}>状态</Text>
      <View style={s.statusRow}>
        <TouchableOpacity style={[s.statusBtn, editStatus === 'Pending' ? s.statusActive : null]} onPress={() => setEditStatus('Pending')}>
          <Text style={[s.statusText, editStatus === 'Pending' ? s.statusTextActive : null]}>待复习</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.statusBtn, editStatus === 'optF5P0W3O' ? s.statusActive : null]} onPress={() => setEditStatus('optF5P0W3O')}>
          <Text style={[s.statusText, editStatus === 'optF5P0W3O' ? s.statusTextActive : null]}>已掌握</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.label}>英文释义</Text>
      <TextInput style={s.input} value={editMeaning} onChangeText={setEditMeaning} multiline />
      <Text style={s.label}>中文释义</Text>
      <TextInput style={s.input} value={editCnMeaning} onChangeText={setEditCnMeaning} multiline />
      <Text style={s.label}>例句</Text>
      <TextInput style={s.input} value={editContext} onChangeText={setEditContext} multiline />
      <Text style={s.label}>干扰词（逗号分隔）</Text>
      <TextInput style={s.input} value={editDistractors} onChangeText={setEditDistractors} />
      <View style={s.btnRow}>
        <TouchableOpacity style={s.redBtn} onPress={removeWord}><Text style={s.btnText}>删除</Text></TouchableOpacity>
        <TouchableOpacity style={s.grayBtn} onPress={() => { setEditWord(null); setScreen('actions'); }}><Text style={s.btnText}>取消</Text></TouchableOpacity>
        <TouchableOpacity style={s.greenBtn} onPress={saveWord}><Text style={s.btnText}>保存</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );

  if (screen === 'addWord') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>录入单词 - {user}</Text>
      <TextInput style={s.input} value={newWord} onChangeText={setNewWord} placeholder="apple, banana, orange" />
      <Text style={s.hint}>释义、例句自动生成</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      <TouchableOpacity style={s.greenBtn} onPress={submitWord}><Text style={s.btnText}>提交</Text></TouchableOpacity>
      <TouchableOpacity style={s.grayBtn} onPress={() => { setNewWord(''); setMessage(''); setScreen('actions'); }}><Text style={s.btnText}>返回</Text></TouchableOpacity>
    </ScrollView>
  );

  if (screen === 'dashboard') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>用户统计看板</Text>
      {allStats.map((item, i) => (
        <View key={i} style={s.card}>
          <Text style={s.bigText}>{item.user}</Text>
          <Text>总单词: {item.totalWords}</Text>
          <Text style={s.green}>已掌握: {item.masteredWords}</Text>
          <Text style={s.orange}>待复习: {item.pendingWords}</Text>
          <Text>测试次数: {item.totalTests || 0}</Text>
          <Text>答题数: {item.totalQuestions || 0}</Text>
          <Text>正确率: {item.accuracyRate}</Text>
        </View>
      ))}
      <TouchableOpacity style={s.grayBtn} onPress={() => setScreen('actions')}><Text style={s.btnText}>返回</Text></TouchableOpacity>
    </ScrollView>
  );

  if (screen === 'learningSettings') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>{'\u5b66\u4e60\u8bbe\u7f6e'} - {user}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      <View style={s.card}>
        <Text style={s.label}>{'\u5f53\u524d\u96be\u5ea6'}</Text>
        <Text style={s.bigText}>{learningSettings?.learningLevel || DEFAULT_LEVEL}</Text>
        <Text style={s.label}>{'\u9898\u5e93\u72b6\u6001'}</Text>
        <Text>{learningSettings?.questionCacheStatus || 'not_started'}</Text>
        <Text>{'\u53ef\u7528\u7f13\u5b58\u9898'}: {cacheStatus?.ready || 0} / {cacheStatus?.total || 0}</Text>
        {learningSettings?.nextLevelChangeAt ? (
          <Text style={s.hint}>{'\u4e0b\u6b21\u53ef\u4fee\u6539'}: {new Date(learningSettings.nextLevelChangeAt).toLocaleDateString()}</Text>
        ) : null}
      </View>
      <View style={s.levelGrid}>
        {LEVEL_OPTIONS.map(({ value, label }) => (
          <TouchableOpacity
            key={value}
            style={[s.levelBtn, selectedLevel === value ? s.statusActive : null]}
            onPress={() => setSelectedLevel(value)}
          >
            <Text style={[s.statusText, selectedLevel === value ? s.statusTextActive : null]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={learningSettings?.canChangeLevel === false ? s.grayBtn : s.greenBtn}
        onPress={learningSettings?.canChangeLevel === false ? undefined : saveLearningSettings}
      >
        <Text style={s.btnText}>{'\u4fdd\u5b58\u96be\u5ea6'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.orangeBtn} onPress={rebuildQuestionCache}><Text style={s.btnText}>{'\u91cd\u5efa\u9884\u751f\u6210\u9898\u5e93'}</Text></TouchableOpacity>
      <TouchableOpacity style={s.grayBtn} onPress={() => setScreen('actions')}><Text style={s.btnText}>返回</Text></TouchableOpacity>
    </ScrollView>
  );

  if (screen === 'actions') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>{user}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      <TouchableOpacity style={s.greenBtn} onPress={startTest}><Text style={s.btnText}>开始测试</Text></TouchableOpacity>
      <TouchableOpacity style={s.orangeBtn} onPress={() => { setNewWord(''); setMessage(''); setScreen('addWord'); }}><Text style={s.btnText}>录入单词</Text></TouchableOpacity>
      <TouchableOpacity style={s.blueBtn} onPress={() => setScreen('searchWord')}><Text style={s.btnText}>查询/编辑单词</Text></TouchableOpacity>
      <TouchableOpacity style={s.blueBtn} onPress={loadLearningSettings}><Text style={s.btnText}>{'\u5b66\u4e60\u8bbe\u7f6e'}</Text></TouchableOpacity>
      <TouchableOpacity style={s.btn} onPress={showDashboard}><Text style={s.btnText}>看板</Text></TouchableOpacity>
      <TouchableOpacity style={s.grayBtn} onPress={() => { setUser(null); setScreen('select'); }}><Text style={s.btnText}>返回</Text></TouchableOpacity>
    </ScrollView>
  );

  if (screen === 'searchWord') return (
    <ScrollView style={s.container}>
      <Text style={s.title}>查询单词</Text>
      <TextInput style={s.input} value={searchWord} onChangeText={setSearchWord} placeholder="输入要查询的单词" />
      {message ? <Text style={s.message}>{message}</Text> : null}
      <TouchableOpacity style={s.greenBtn} onPress={searchWordAction}><Text style={s.btnText}>查询</Text></TouchableOpacity>
      <TouchableOpacity style={s.grayBtn} onPress={() => { setSearchWord(''); setMessage(''); setScreen('actions'); }}><Text style={s.btnText}>返回</Text></TouchableOpacity>
    </ScrollView>
  );

  return (
    <View style={s.center}>
      <Text style={s.title}>单词机器人</Text>
      <TouchableOpacity style={s.btn} onPress={() => chooseUser('yusi')}><Text style={s.btnText}>yusi</Text></TouchableOpacity>
      <TouchableOpacity style={s.btn} onPress={() => chooseUser('qiuqiu')}><Text style={s.btnText}>qiuqiu</Text></TouchableOpacity>
      <TouchableOpacity style={s.btn} onPress={showDashboard}><Text style={s.btnText}>看板</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5' },
  center: { flex: 1, padding: 20, backgroundColor: '#f5f5f5', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: '#333' },
  typeLabel: { fontSize: 18, color: '#6200EE', textAlign: 'center', marginBottom: 15, fontWeight: '600' },
  bigTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginVertical: 20, color: '#6200EE' },
  score: { fontSize: 48, fontWeight: 'bold', textAlign: 'center', color: '#333' },
  accuracy: { fontSize: 20, textAlign: 'center', color: '#666', marginBottom: 20 },
  rewardCard: { backgroundColor: '#FFF8E1', padding: 15, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#F3D26A' },
  rewardTitle: { fontSize: 18, fontWeight: 'bold', color: '#5F4B00', marginBottom: 8 },
  rewardGood: { color: '#2E7D32', fontWeight: 'bold', marginTop: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 15, textAlign: 'center' },
  bigText: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  message: { textAlign: 'center', color: '#FF5722', marginVertical: 10, fontSize: 16 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10 },
  btn: { backgroundColor: '#6200EE', padding: 15, borderRadius: 10, marginVertical: 8 },
  greenBtn: { backgroundColor: '#4CAF50', padding: 15, borderRadius: 10, marginVertical: 8 },
  orangeBtn: { backgroundColor: '#FF5722', padding: 15, borderRadius: 10, marginVertical: 8 },
  grayBtn: { backgroundColor: '#666', padding: 15, borderRadius: 10, marginVertical: 8 },
  blueBtn: { backgroundColor: '#2196F3', padding: 15, borderRadius: 10, marginVertical: 8 },
  redBtn: { backgroundColor: '#F44336', padding: 15, borderRadius: 10, marginVertical: 8 },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 12 },
  levelBtn: { width: '47%', padding: 12, borderRadius: 8, borderWidth: 2, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  statusRow: { flexDirection: 'row', marginBottom: 15 },
  statusBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 2, borderColor: '#ddd', marginRight: 10, alignItems: 'center' },
  statusActive: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  statusText: { fontSize: 16, color: '#666' },
  statusTextActive: { color: '#4CAF50', fontWeight: 'bold' },
  btnText: { color: '#fff', fontSize: 18, textAlign: 'center', fontWeight: '600' },
  btnRow: { flexDirection: 'row', justifyContent: 'space-between' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginVertical: 10 },
  hint: { fontSize: 12, color: '#999', marginBottom: 10 },
  label: { fontSize: 14, color: '#6200EE', marginBottom: 10 },
  context: { fontSize: 18, color: '#333', lineHeight: 28 },
  option: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 2, borderColor: '#e0e0e0' },
  selected: { borderColor: '#6200EE', backgroundColor: '#EDE7F6' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  prevBtn: { backgroundColor: '#FF9800', padding: 12, borderRadius: 8, flex: 1, marginRight: 5 },
  nextBtn: { backgroundColor: '#2196F3', padding: 12, borderRadius: 8, flex: 1, marginLeft: 5 },
  submitBtn: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 8, flex: 1, marginLeft: 5 },
  navText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  green: { color: '#4CAF50', fontSize: 16 },
  orange: { color: '#FF9800', fontSize: 16 },
  greenCard: { backgroundColor: '#E8F5E9', padding: 15, borderRadius: 10, marginBottom: 10 },
  redCard: { backgroundColor: '#FFEBEE', padding: 15, borderRadius: 10, marginBottom: 10 },
  multiItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderColor: '#eee' },
  checkbox: { width: 28, height: 28, borderWidth: 2, borderColor: '#6200EE', borderRadius: 4, marginRight: 15, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  checkmark: { color: '#6200EE', fontSize: 18, fontWeight: 'bold' },
  checkEmpty: { color: '#ccc', fontSize: 18 },
  multiWord: { fontSize: 18, color: '#333' },
});
