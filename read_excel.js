const XLSX = require('xlsx');

const workbook = XLSX.readFile('单词机器人-数据 副本_生产-单词表.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(worksheet);

console.log('列名:', Object.keys(rows[0] || {}));
console.log('总行数:', rows.length);
console.log('\n前3行数据:');
rows.slice(0, 3).forEach((r, i) => {
    console.log('行' + (i+1) + ':', JSON.stringify(r));
});
