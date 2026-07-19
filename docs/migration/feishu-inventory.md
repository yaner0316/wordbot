# Feishu Production Inventory

Generated: 2026-07-17T07:02:00.311Z
Model: GPT-5 Codex
Reasoning effort: not exposed by this runtime

Scope: read-only inventory of WORD, TEST/assessment, and QUESTION_CACHE production Feishu Bitable tables. No Feishu writes were performed.

## Summary

| table | records | fields | users | emptyUsers | emptyRows | mixedTypeFields |
| --- | --- | --- | --- | --- | --- | --- |
| WORD | 454 | 29 | 6 | 0 | 0 | 0 |
| TEST | 2500 | 18 | 5 | 10 | 10 | 0 |
| QUESTION_CACHE | 708 | 18 | 5 | 0 | 0 | 0 |

## Cross-table User-key Profile

Users present in one table but not all tables: 1

| user | present | missing |
| --- | --- | --- |
| test_user1 | WORD | TEST, QUESTION_CACHE |

Users whose raw casing/whitespace differs across tables: 1

| user | variants |
| --- | --- |
| draggy | TEST:Draggy (479), QUESTION_CACHE:Draggy (32), WORD:Draggy (31), TEST:draggy (10) |

## WORD

- Table ID: `tblyMh69dws6ty6n`
- Total records: 454
- Fully empty rows: 0
- Distinct normalized users: 6
- Empty user rows: 0

### Field Coverage and Types

| field | populated | empty/null/missing | types | distinctValues |
| --- | --- | --- | --- | --- |
| auth_created_at | 6 | 448 | number | 6 (not listed) |
| auth_password_hash | 6 | 448 | string | 6 (not listed) |
| auth_password_salt | 6 | 448 | string | 6 (not listed) |
| CN_Meaning | 416 | 38 | string | 410 (not listed) |
| Context | 407 | 47 | string | 401 (not listed) |
| Context_CN | 366 | 88 | string | 365 (not listed) |
| Distractors | 451 | 3 | string | 450 (not listed) |
| Error_Count | 333 | 121 | string | 6 (not listed) |
| Learning_Level | 3 | 451 | string | 2 |
| Level | 319 | 135 | string | 4 |
| Level_Changed_At | 3 | 451 | number | 3 (not listed) |
| Meaning | 451 | 3 | string | 444 (not listed) |
| multi_definition | 303 | 151 | array | 3 |
| Old_Distractors | 310 | 144 | string | 310 (not listed) |
| parent_created_at | 4 | 450 | number | 4 (not listed) |
| parent_password_hash | 4 | 450 | string | 4 (not listed) |
| parent_password_salt | 4 | 450 | string | 4 (not listed) |
| parent_username | 4 | 450 | string | 2 (not listed) |
| phone | 2 | 452 | string | 2 (not listed) |
| phone_verified_at | 2 | 452 | number | 2 (not listed) |
| POS | 244 | 210 | string | 14 |
| Quality_Flags | 46 | 408 | string | 2 (not listed) |
| Quality_Note | 46 | 408 | string | 33 (not listed) |
| Question_Cache_Status | 3 | 451 | string | 1 |
| record_time | 451 | 3 | number | 446 (not listed) |
| remember_time | 68 | 386 | number | 68 (not listed) |
| Status | 451 | 3 | string | 3 |
| user | 454 | 0 | string | 6 (not listed) |
| Word | 451 | 3 | string | 440 (not listed) |

### Enum-like Values

#### Learning_Level

- `小学`: 2
- `高中`: 1

#### Level

- `高中`: 215
- `小学`: 50
- `CET4_6_TOEFL`: 41
- `中学`: 13

#### multi_definition

- `optpWwFJpq`: 290
- `opthB7bmkB`: 8
- `optH7bmkB`: 5

#### POS

- `noun`: 86
- `verb`: 71
- `adjective`: 56
- `adverb`: 6
- `n.`: 6
- `interjection`: 5
- `phrasal verb`: 5
- `pronoun`: 2
- `suffix`: 2
- `determiner`: 1
- `noun, adjective`: 1
- `numeral`: 1
- `preposition`: 1
- `verb phrase`: 1

#### Question_Cache_Status

- `building`: 3

#### Status

- `Pending`: 250
- `Mastered`: 136
- `optXjbXS2F`: 65

### Dirty Data Profile

Mixed-type fields: None

Duplicate/ambiguous users within table: 0

Malformed rows by required-field heuristic:
- Missing `user`: 0
- Missing `Word`: 3 (`recvnacJpRa48s`, `recvnfE765MZdP`, `recvpw4lpJj2uE`)
- Missing `Meaning`: 3 (`recvnacJpRa48s`, `recvnfE765MZdP`, `recvpw4lpJj2uE`)
- Missing `CN_Meaning`: 38 (`recvlmWq7lDOXz`, `recvnacJpRa48s`, `recvnadX66165O`, `recvnfE765MZdP`, `recvocxcrNn5is`, `recvpaiMVA2QXa`, `recvpaiNh9jwwL`, `recvpaiWsPCASL`, `recvpaiWORalEn`, `recvpaiXbb7KYb`, `recvpaiXwpx9z7`, `recvpaiXTVJlJb`, `recvpaiYfPoDVx`, `recvpaiYCTgfyT`, `recvpaiYYbxglS`, `recvpaiZiWKAwS`, `recvpaj00bxZgJ`, `recvpaj0l7CjBz`, `recvpaj0GETTKE`, `recvpaj12OpeWv`, `recvpaj1oyzUFh`, `recvpefNHZHgFB`, `recvpefOeIHVRx`, `recvpefOHqKUDK`, `recvpefPx97iwm`, `recvpefPWsLS4O`, `recvpefQq8CpbB`, `recvpefQP8s18f`, `recvpefReF0syw`, `recvpefRE301Cd`, `recvpefS3eVI1q`, `recvpefSsiAFTr`, `recvpefTdQfOed`, `recvpefU4FoNCJ`, `recvpefUurUubi`, `recvpqqULMIZS4`, `recvpw4lpJj2uE`, `recvpwoHysVURA`)
- Missing `Status`: 3 (`recvnacJpRa48s`, `recvnfE765MZdP`, `recvpw4lpJj2uE`)

### Candidate Keys

- Feishu record_id: complete rows 454/454; duplicate groups 0
- (user, Word): complete rows 451/454; duplicate groups 3
- `qiuqiu || engineer`: 2
- `yusi || contract`: 2
- `yusi || promotion`: 2
- (user, Word, Meaning): complete rows 451/454; duplicate groups 0

## TEST

- Table ID: `tbl6Nx0kJWjr7qQZ`
- Total records: 2500
- Fully empty rows: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Distinct normalized users: 5
- Empty user rows: 10

### Field Coverage and Types

| field | populated | empty/null/missing | types | distinctValues |
| --- | --- | --- | --- | --- |
| assessment_kind | 132 | 2368 | string | 1 (not listed) |
| context | 1218 | 1282 | string | 375 (not listed) |
| correct_answer | 2489 | 11 | string | 79 (not listed) |
| is_correct | 644 | 1856 | array | 2 |
| level | 1500 | 1000 | string | 5 |
| options | 2490 | 10 | string | 1396 (not listed) |
| question_type | 2490 | 10 | string | 4 |
| record_id | 2490 | 10 | string | 348 (not listed) |
| review_round | 132 | 2368 | string | 1 (not listed) |
| review_status | 132 | 2368 | string | 4 (not listed) |
| source | 1500 | 1000 | string | 2 |
| source_question_id | 132 | 2368 | string | 120 (not listed) |
| source_test_id | 132 | 2368 | string | 43 (not listed) |
| test_id | 2490 | 10 | string | 283 (not listed) |
| test_time | 2490 | 10 | number | 2485 (not listed) |
| user | 2490 | 10 | string | 6 (not listed) |
| word | 2490 | 10 | string | 334 (not listed) |
| your_answer | 692 | 1808 | string | 53 (not listed) |

### Enum-like Values

#### is_correct

- `optHGT7gYf`: 502
- `optbe4bsQk`: 142

#### level

- `中学`: 490
- `小学`: 470
- `高中`: 460
- `??`: 60
- `Сѧ`: 20

#### question_type

- `1`: 1477
- `3`: 490
- `2`: 408
- `4`: 115

#### source

- `question_cache`: 1210
- `live_fallback`: 290

### Dirty Data Profile

Mixed-type fields: None

Duplicate/ambiguous users within table: 1

| normalized | variants |
| --- | --- |
| draggy | "Draggy" (479), "draggy" (10) |

Malformed rows by required-field heuristic:
- Missing `user`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing `test_id`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing `record_id`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing `word`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing `question_type`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing `correct_answer`: 11 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`, `recvobMpQrQBC9`)
- Missing `options`: 10 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`)
- Missing submitted field `is_correct`: 1856 (`rec27jSJiKonjJ`, `rec27jSJiKorJZ`, `rec27jSJiKotOj`, `rec27jSJiKovZY`, `rec27jSJiKoxL7`, `rec27jSJiKoAu2`, `rec27jSJiKoD7e`, `rec27jSJiKoFpc`, `rec27jSJiKoKOh`, `rec27jSJiKoMQ7`, `recvmqwuPYMW0w`, `recvmqwuPYehgH`, `recvmqwuPYk8cT`, `recvmqwuPYg3ih`, `recvmqwuPY3ea0`, `recvmqwuPYFZao`, `recvmqwuPY1mKd`, `recvmqwuPYtFUZ`, `recvmqwuPYU781`, `recvmqwuPYsfND`, `recvmB2vuNptg7`, `recvmB2wiQ544b`, `recvmB2wZBCT6c`, `recvmB2xEYF91q`, `recvmB2ytMRWp2`, `recvmB2zbFrJTP`, `recvmB2zQqvKNI`, `recvmB2AxQehdh`, `recvmB2BcgvVTH`, `recvmB2BPSz9VT`, `recvmB3zBIjMYr`, `recvmB3AnJTWeC`, `recvmB3B2DcLiv`, `recvmB3BHGsd8I`, `recvmB3CqnPluq`, `recvmB3D6JrzgC`, `recvmB3DQzPMv9`, `recvmB3EyIoJLd`, `recvmB3FeejDrQ`, `recvmB3FTMBp8Y` ... (1816 more))

### Candidate Keys

- Feishu record_id: complete rows 2500/2500; duplicate groups 0
- (user, test_id, record_id): complete rows 2490/2500; duplicate groups 6
- `draggy || real-5a44d77b || recvmxl5loovkf`: 2
- `qiuqiu || real-f57029c7 || recvisxisitgwk`: 2
- `qiuqiu || real-f57029c7 || recvisxjz03zeo`: 2
- `qiuqiu || real-f57029c7 || recvisxkf3imf5`: 2
- `qiuqiu || real-f57029c7 || recvisxktv8hjf`: 2
- `qiuqiu || real-review-80022a86 || recvisxkf3imf5`: 2
- (test_id, record_id): complete rows 2490/2500; duplicate groups 6
- `real-5a44d77b || recvmxl5loovkf`: 2
- `real-f57029c7 || recvisxisitgwk`: 2
- `real-f57029c7 || recvisxjz03zeo`: 2
- `real-f57029c7 || recvisxkf3imf5`: 2
- `real-f57029c7 || recvisxktv8hjf`: 2
- `real-review-80022a86 || recvisxkf3imf5`: 2

## QUESTION_CACHE

- Table ID: `tblLWDBvlQHBo0n3`
- Total records: 708
- Fully empty rows: 0
- Distinct normalized users: 5
- Empty user rows: 0

### Field Coverage and Types

| field | populated | empty/null/missing | types | distinctValues |
| --- | --- | --- | --- | --- |
| ai_audit_status | 707 | 1 | string | 1 (not listed) |
| answer | 708 | 0 | string | 4 (not listed) |
| context_cn | 483 | 225 | string | 250 (not listed) |
| correct_meaning | 700 | 8 | string | 187 (not listed) |
| generated_at | 708 | 0 | string | 389 (not listed) |
| last_used_at | 243 | 465 | string | 153 (not listed) |
| level | 708 | 0 | string | 3 |
| option_meanings | 708 | 0 | string | 643 (not listed) |
| options | 708 | 0 | string | 622 (not listed) |
| quality_status | 708 | 0 | string | 1 |
| question_text | 708 | 0 | string | 268 (not listed) |
| question_type | 708 | 0 | string | 3 |
| round_type | 708 | 0 | string | 2 |
| source_version | 707 | 1 | string | 1 (not listed) |
| used_count | 708 | 0 | string | 4 (not listed) |
| user | 708 | 0 | string | 5 (not listed) |
| word | 708 | 0 | string | 134 (not listed) |
| word_record_id | 708 | 0 | string | 136 (not listed) |

### Enum-like Values

#### level

- `中学`: 364
- `高中`: 263
- `小学`: 81

#### quality_status

- `ready`: 708

#### question_type

- `1`: 353
- `2`: 311
- `3`: 44

#### round_type

- `primary`: 388
- `review`: 320

### Dirty Data Profile

Mixed-type fields: None

Duplicate/ambiguous users within table: 0

Malformed rows by required-field heuristic:
- Missing `user`: 0
- Missing `word_record_id`: 0
- Missing `word`: 0
- Missing `question_type`: 0
- Missing `level`: 0
- Missing `round_type`: 0
- Missing `quality_status`: 0
- Missing `question_text`: 0
- Missing `options`: 0
- Missing `answer`: 0

### Candidate Keys

- Feishu record_id: complete rows 708/708; duplicate groups 0
- (user, word_record_id, question_type, round_type, level): complete rows 708/708; duplicate groups 126
- `qiuqiu || recvisxa18cfj8 || 1 || primary || 中学`: 12
- `qiuqiu || recvisxa18cfj8 || 2 || review || 中学`: 12
- `qiuqiu || recvisxakdkgda || 1 || primary || 中学`: 12
- `qiuqiu || recvisxakdkgda || 2 || review || 中学`: 12
- `qiuqiu || recvisxycu5k3z || 1 || primary || 中学`: 12
- `qiuqiu || recvisxycu5k3z || 2 || review || 中学`: 12
- `qiuqiu || recvisxbqzewtc || 1 || primary || 中学`: 10
- `qiuqiu || recvisxbqzewtc || 2 || review || 中学`: 10
- `qiuqiu || recvisxc5qcyvp || 1 || primary || 中学`: 10
- `qiuqiu || recvisxc5qcyvp || 2 || review || 中学`: 10
- `qiuqiu || recvisxducpref || 1 || primary || 中学`: 9
- `qiuqiu || recvisxducpref || 2 || review || 中学`: 9
- `qiuqiu || recvisxhxfp4kz || 1 || primary || 中学`: 9
- `qiuqiu || recvisxea7zl7s || 1 || primary || 中学`: 8
- `qiuqiu || recvisxea7zl7s || 2 || review || 中学`: 8
- `qiuqiu || recvisxhxfp4kz || 2 || review || 中学`: 8
- `qiuqiu || recvisxisitgwk || 2 || review || 中学`: 7
- `yusi || recvisxolwomul || 1 || primary || 高中`: 7
- `yusi || recvisxolwomul || 2 || review || 高中`: 7
- `yusi || recvisxozh0nbe || 1 || primary || 高中`: 7
- (user, word, question_type, round_type, level): complete rows 708/708; duplicate groups 126
- `qiuqiu || although || 1 || primary || 中学`: 12
- `qiuqiu || although || 2 || review || 中学`: 12
- `qiuqiu || plenty of || 1 || primary || 中学`: 12
- `qiuqiu || plenty of || 2 || review || 中学`: 12
- `qiuqiu || though || 1 || primary || 中学`: 12
- `qiuqiu || though || 2 || review || 中学`: 12
- `qiuqiu || dyed || 1 || primary || 中学`: 10
- `qiuqiu || dyed || 2 || review || 中学`: 10
- `qiuqiu || tour guide || 1 || primary || 中学`: 10
- `qiuqiu || tour guide || 2 || review || 中学`: 10
- `qiuqiu || engine || 1 || primary || 中学`: 9
- `qiuqiu || monthly || 1 || primary || 中学`: 9
- `qiuqiu || monthly || 2 || review || 中学`: 9
- `qiuqiu || engine || 2 || review || 中学`: 8
- `qiuqiu || spider || 1 || primary || 中学`: 8
- `qiuqiu || spider || 2 || review || 中学`: 8
- `qiuqiu || strange || 2 || review || 中学`: 7
- `yusi || applicant || 1 || primary || 高中`: 7
- `yusi || applicant || 2 || review || 高中`: 7
- `yusi || fax || 1 || primary || 高中`: 7

## Notes for Postgres Design

- Feishu `record_id` is unique in the observed export for each table and is the safest migration primary key or immutable external ID.
- Natural keys should be lowercased/trimmed for user and word components before uniqueness checks because casing and whitespace variants were profiled separately above.
- Fields marked as mixed-type should be normalized before relational typing, or stored in JSONB until write paths are tightened.
- Required-field heuristics are based on current application read/write behavior, not Feishu schema metadata.
