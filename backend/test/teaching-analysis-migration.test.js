const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {MIGRATION_PATHS,VERIFICATION_SQL}=require('../scripts/apply-question-generation-migrations');
test('teaching snapshots use an ordered migration and explicit verification keys',()=>{
 const names=MIGRATION_PATHS.map(file=>path.basename(file));
 assert.ok(names.indexOf('20261013_teaching_analysis_snapshots.sql')>=0);
 assert.ok(names.indexOf('20261013_custom_practice.sql')>names.indexOf('20261013_teaching_analysis_snapshots.sql'));
 for(const key of ['teaching_analysis_cache_column','teaching_analysis_assessment_column','teaching_analysis_publish_contract','teaching_analysis_challenge_trigger']) assert.ok(VERIFICATION_SQL.includes(key));
});
