const { getRuntimeHealth } = require('./runtime-health');

const health = getRuntimeHealth();

console.log(JSON.stringify(health, null, 2));

if (!health.ok) {
    process.exitCode = 1;
}
