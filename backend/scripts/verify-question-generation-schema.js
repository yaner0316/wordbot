'use strict';

const {
  publicFailureMessage,
  verifyQuestionGenerationSchema,
} = require('./apply-question-generation-migrations');

async function main() {
  const result = await verifyQuestionGenerationSchema();
  console.log(JSON.stringify({
    component: 'question-generation-schema',
    ...result,
  }));
  if (result.status !== 'ok') process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[question-generation-schema] ${publicFailureMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  verifyQuestionGenerationSchema,
};
