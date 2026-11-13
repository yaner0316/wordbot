function parseEntryWords(value) {
  const words = [...new Set(String(value || '').split(/[\n,，;；]+/).map(word => word.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
  if (!words.length || words.length > 50 || words.some(word => !/^[a-z]+(?:[ '-][a-z]+)*$/.test(word))) {
    throw new Error('请只输入英文单词或短语，一行一个，再选择具体词义；每批最多 50 个。');
  }
  return words;
}
function selectedEntryPayload(items) {
  if (!items?.length) throw new Error('请先查询词义');
  return items.flatMap(item => {
    const chosen = (item.selected || []).map(index => item.senses[index]).filter(sense => sense?.selectionToken);
    if (!chosen.length) throw new Error('请为 ' + item.word + ' 选择至少一个具体词义');
    return chosen.map(sense => ({ word: item.word, selectionToken: sense.selectionToken }));
  });
}
module.exports = { parseEntryWords, selectedEntryPayload };
