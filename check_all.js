const XLSX = require('xlsx');
const { getToken, request } = require('./backend/feishu');

const workbook = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const excelData = XLSX.utils.sheet_to_json(worksheet);

console.log('Excel数据统计:');
console.log('- 总行数:', excelData.length);

const statusValues = new Set();
const multiValues = new Set();
excelData.forEach(row => {
    if (row['是否多义词']) multiValues.add(row['是否多义词']);
    if (row['状态']) statusValues.add(row['状态']);
});

console.log('\n"是否多义词"字段的可能值:');
console.log(Array.from(multiValues));

console.log('\n"状态"字段的可能值:');
console.log(Array.from(statusValues));

console.log('\n前10条数据:');
excelData.slice(0, 10).forEach((row, i) => {
    console.log(`${i+1}. 单词: ${row['单词']}, 状态: ${row['状态']}, 是否多义词: ${row['是否多义词']}`);
});
