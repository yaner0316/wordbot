import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';

const API = 'http://localhost:3000';

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
        body: JSON.stringify({ user })
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

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#6200EE" /><Text>加载中...</Text></View>;

  if (screen === 'results' && results) return (
    <ScrollView style={s.container}>
      <Text style={s.bigTitle}>批改结果</Text>
      <Text style={s.score}>{results.correct} / {results.total}</Text>
      <Text style={s.accuracy}>{results.accuracy}</Text>
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
          <Text>正确率: {item.accuracyRate}</Text>
        </View>
      ))}
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
