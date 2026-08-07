'use strict';

const path = require('node:path');

// Injected production variables keep precedence; this only fills local gaps.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: false });
