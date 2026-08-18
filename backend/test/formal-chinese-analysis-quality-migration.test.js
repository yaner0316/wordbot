'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260818_formal_chinese_analysis_quality_gate.sql'), 'utf8');

test('formal Chinese analysis migration rejects English meanings and incomplete context translation', async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.quiz_challenge_questions (
        id uuid primary key,
        question_fingerprint text,
        question_snapshot jsonb not null
      );
    `);
    try {
        await db.exec(migration);
        await db.exec(migration);
        await db.query(`
          insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
          values ('00000000-0000-0000-0000-000000000001', 'valid',
            '{"answer":"A","contextCN":"这个学生午饭后吃了一个苹果。","optionMeanings":["苹果","梨","椅子","道路"]}'::jsonb)
        `);
        await db.query(`
          insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
          values ('00000000-0000-0000-0000-000000000004', 'legacy-nested',
            '{"question_snapshot":{"answer":"A","contextCN":"这个学生午饭后吃了一个苹果。","optionMeanings":["苹果","梨","椅子","道路"]}}'::jsonb)
        `);
        await assert.rejects(db.query(`
          insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
          values ('00000000-0000-0000-0000-000000000005', 'missing-meanings',
            '{"answer":"A","contextCN":"这个学生午饭后吃了一个苹果。"}'::jsonb)
        `), /option_meanings/);
        await assert.rejects(db.query(`
          insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
          values ('00000000-0000-0000-0000-000000000002', 'english',
            '{"answer":"A","contextCN":"这个学生午饭后吃了一个苹果。","optionMeanings":["apple","pear","chair","road"]}'::jsonb)
        `), /chinese_option_meanings/);
        await assert.rejects(db.query(`
          insert into public.quiz_challenge_questions (id, question_fingerprint, question_snapshot)
          values ('00000000-0000-0000-0000-000000000003', 'short-context',
            '{"answer":"A","contextCN":"苹果","optionMeanings":["苹果","梨","椅子","道路"]}'::jsonb)
        `), /context_zh/);
    } finally {
        await db.close();
    }
});
