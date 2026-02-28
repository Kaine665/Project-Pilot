# 数据库快照

> 获取时间：2026-02-27 00:47:39
> 数据库：ELApp 生产环境 (http://81.68.249.18:8100)
> 表总数：35

## 概览

| # | 表名 | 行数 | 字段数 | 说明 |
|---|------|------|--------|------|
| 1 | app_releases | 0 | 0 | - |
| 2 | archive | 0 | 0 | - |
| 3 | books | 50 | 27 | - |
| 4 | conversation_messages | 0 | 0 | - |
| 5 | conversations | 0 | 0 | - |
| 6 | dict_curated | 8106 | 13 | - |
| 7 | dict_ecdict | 59137 | 7 | - |
| 8 | exercise_results | 0 | 0 | - |
| 9 | exercises | 0 | 0 | - |
| 10 | feedback | 0 | 0 | - |
| 11 | grammar_history | 0 | 0 | - |
| 12 | grammar_rules | 5 | 21 | - |
| 13 | knowledge_domains | 0 | 0 | - |
| 14 | knowledge_points | 0 | 0 | - |
| 15 | phrases | 89 | 21 | - |
| 16 | platform_book_chapters | 0 | 0 | - |
| 17 | platform_books | 10 | 12 | - |
| 18 | review_queue | 0 | 0 | - |
| 19 | sentences | 0 | 0 | - |
| 20 | user_books | 29 | 11 | - |
| 21 | user_preferences | 57 | 23 | - |
| 22 | user_reading_fragments | 90 | 12 | - |
| 23 | user_reading_material_words | 0 | 0 | - |
| 24 | user_reading_materials | 1042 | 27 | - |
| 25 | user_vocabulary_libraries | 53 | 14 | - |
| 26 | users | 57 | 14 | - |
| 27 | v_word_reading_stats | 3603 | 12 | - |
| 28 | vocabulary_index | 8107 | 4 | - |
| 29 | vocabulary_libraries | 14 | 16 | - |
| 30 | vocabulary_library_words | 22621 | 13 | - |
| 31 | word_classifications | 68 | 5 | - |
| 32 | word_distractors | 0 | 0 | - |
| 33 | word_history | 4961 | 18 | - |
| 34 | word_relations | 0 | 0 | - |
| 35 | words | 3603 | 29 | - |

---

## app_releases

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## archive

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## books

**行数：50**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| author | text | YES |  |
| author_contact | text | YES |  |
| copyright_holder | text | YES |  |
| copyright_holder_contact | text | YES |  |
| copyright_status | text | YES |  |
| copyright_year | text | YES |  |
| cover_url | text | YES |  |
| created_at | timestamptz | YES |  |
| created_by | text | YES |  |
| description | text | YES |  |
| description_zh | text | YES |  |
| difficulty | text | YES |  |
| genre | array | YES |  |
| id | uuid | NO | PK |
| is_published | boolean | YES |  |
| language | text | YES |  |
| license_notes | text | YES |  |
| license_type | text | YES |  |
| original_publication_year | text | YES |  |
| publisher | text | YES |  |
| source_platform | text | YES |  |
| source_url | text | YES |  |
| tags | array | YES |  |
| title | text | YES |  |
| title_zh | text | YES |  |
| total_chapters | text | YES |  |
| updated_at | timestamptz | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"56cd4edd-96f6-40b6-a528-47f097968360","title":"Grimm's Fairy Tales","title_zh":"格林童话","author":"Brothers Grimm","description":"A collection of German fairy tales by the Brothers Grimm, including Cinderella, Snow White, and Hansel and Gretel.","description_zh":"格林兄弟收集的德国童话，包括《灰姑娘》《白雪公主》《糖果屋》等。","cover_url":"http://releases.skillbridge.asia/book-covers/grimms-fairy-tales.jpg","language":"en","genre":["fairy-tale","children","folklore"],"difficulty":2,"tags":["fiction","classic"],"original_publication_year":1812,"publisher":null,"copyright_status":"public_domain","copyright_year":1859,"copyright_holder":null,"license_type":"public_domain","license_notes":"Available via Project Gutenberg. Original work entered public domain. Verified on 2026-02-19.","copyright_holder_contact":null,"author_contact":null,"source_platform":"gutenberg","source_url":"https://www.gutenberg.org/ebooks/2591","is_published":true,"total_chapters":0,"created_by":null,"created_at":"2026-02-19T02:07:15.417532+00:00","updated_at":"2026-02-19T02:07:15.417532+00:00"}]

```

</details>

---

## conversation_messages

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## conversations

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## dict_curated

**行数：8106**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| distractors | array | YES |  |
| id | uuid | NO | PK |
| level | text | YES |  |
| meanings | array | YES |  |
| phonetic_uk | text | YES |  |
| phonetic_us | text | YES |  |
| pos | text | YES |  |
| source | text | YES |  |
| source_library | text | YES |  |
| translation | text | YES |  |
| updated_at | timestamptz | YES |  |
| word | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"309cb839-ff2d-4f82-a050-a127a73867c9","word":"advertising","phonetic_us":"/ˈædvərtaɪzɪŋ/","phonetic_uk":"/ˈædvətaɪzɪŋ/","meanings":[{"pos": "n.", "level": 0, "source": "primary", "translation": ""}],"distractors":[],"source_library":"primary","created_at":"2026-02-21T02:24:13.003178+00:00","updated_at":"2026-02-21T02:24:24.357141+00:00"}]

```

</details>

---

## dict_ecdict

**行数：59137**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| exchange | text | YES |  |
| id | uuid | NO | PK |
| phonetic | text | YES |  |
| pos | text | YES |  |
| translation | text | YES |  |
| word | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"2d052264-39e3-4c32-917f-d24fe7ce58ae","word":"a","phonetic":"ei","translation":"第一个字母 A，一个，第一的","pos":"a","exchange":"s:some","created_at":"2026-02-21T02:21:25.329376+00:00"}]

```

</details>

---

## exercise_results

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## exercises

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## feedback

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## grammar_history

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## grammar_rules

**行数：5**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| context | jsonb | YES |  |
| correct_example | text | YES |  |
| correct_reviews | text | YES |  |
| created_at | timestamptz | YES |  |
| first_seen | text | YES |  |
| id | uuid | NO | PK |
| last_reviewed_at | timestamptz | YES |  |
| metadata | jsonb | YES |  |
| next_review_date | timestamptz | YES |  |
| notes | jsonb | YES |  |
| original_text | text | YES |  |
| rule_description | text | YES |  |
| rule_name | text | YES |  |
| source_id | uuid | YES |  |
| source_material_id | uuid | YES |  |
| source_type | text | YES |  |
| status | text | YES |  |
| total_reviews | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |
| wrong_example | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"8cd04cf6-372b-4d4a-8e11-9faf0bf1b4b8","user_id":"0804d249-78bf-4780-afac-4ae3b03fe3c8","rule_name":"either...or...","rule_description":"要么…要么…","wrong_example":null,"correct_example":"He did not trouble himself\nin the least about his soldiers; nor did he care to go either to the\ntheatre or the chase, except for the opportunities then afforded him for\ndisplaying his new clothes.","status":"learning","source_type":"reading","source_id":"0326af11-2bd5-4d28-b442-d6459578a98d","first_seen":"2026-02-24T13:41:33.28+00:00","context":"He did not trouble himself\nin the least about his soldiers; nor did he care to go either to the\ntheatre or the chase, except for the opportunities then afforded him for\ndisplaying his new clothes.","notes":null,"total_reviews":0,"correct_reviews":0,"last_reviewed_at":null,"next_review_date":null,"metadata":{"original_text": "He did not trouble himself\nin the least about his soldiers; nor did he care to go either to the\ntheatre or the chase, except for the opportunities then afforded him for\ndisplaying his new clothes", "source_material_id": "0326af11-2bd5-4d28-b442-d6459578a98d"},"created_at":"2026-02-24T13:41:33.489558+00:00","updated_at":"2026-02-24T13:41:33.489558+00:00"}]

```

</details>

---

## knowledge_domains

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## knowledge_points

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## phrases

**行数：89**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| correct_reviews | text | YES |  |
| created_at | timestamptz | YES |  |
| first_seen | text | YES |  |
| formality | text | YES |  |
| id | uuid | NO | PK |
| last_reviewed_at | timestamptz | YES |  |
| metadata | jsonb | YES |  |
| next_review_date | timestamptz | YES |  |
| notes | jsonb | YES |  |
| original_text | text | YES |  |
| phrase | text | YES |  |
| source_id | uuid | YES |  |
| source_material_id | uuid | YES |  |
| source_type | text | YES |  |
| status | text | YES |  |
| subtype | text | YES |  |
| total_reviews | text | YES |  |
| translation | text | YES |  |
| updated_at | timestamptz | YES |  |
| usage_context | text | YES |  |
| user_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"e9cf0182-8df4-4333-a75b-beb7c808b937","user_id":"b9d34dba-5ae7-43de-aaaa-d59f168400ee","phrase":"in the accepted sense of the word","translation":"在通常/公认的意义上","usage_context":"But in my opinion this person, whoever he may be, is not sane in the accepted sense of the word.","formality":"neutral","status":"learning","source_type":"reading","source_id":"5c5584d9-9a3e-4f46-bf6c-181f16a2811f","first_seen":"2026-02-22T15:31:26.676+00:00","notes":"这是固定表达，用于限定对某个词语或概念的理解，强调其普遍接受的含义。","total_reviews":0,"correct_reviews":0,"last_reviewed_at":null,"next_review_date":null,"metadata":{"subtype": "expression", "original_text": "But in my opinion this person, whoever he may be, is not sane in the accepted sense of the word", "source_material_id": "5c5584d9-9a3e-4f46-bf6c-181f16a2811f"},"created_at":"2026-02-22T15:31:27.131495+00:00","updated_at":"2026-02-22T15:31:27.131495+00:00"}]

```

</details>

---

## platform_book_chapters

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## platform_books

**行数：10**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| book_id | uuid | YES |  |
| category | text | YES |  |
| chapters_ready | text | YES |  |
| created_at | timestamptz | YES |  |
| id | uuid | NO | PK |
| is_featured | boolean | YES |  |
| published_at | timestamptz | YES |  |
| sort_order | text | YES |  |
| status | text | YES |  |
| total_favorites | text | YES |  |
| total_readers | text | YES |  |
| updated_at | timestamptz | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"db25fc0e-8b2e-49bc-af01-416be4e57ba7","book_id":"72fc1732-6656-4e50-9bae-957a306d80b2","is_featured":false,"sort_order":30,"category":"童话寓言","status":"published","chapters_ready":6,"published_at":"2026-02-20T09:39:12.145008+00:00","total_readers":0,"total_favorites":0,"created_at":"2026-02-20T09:39:12.145008+00:00","updated_at":"2026-02-21T00:55:04.182+00:00"}]

```

</details>

---

## review_queue

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## sentences

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## user_books

**行数：29**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| added_at | timestamptz | YES |  |
| current_chapter_index | text | YES |  |
| id | uuid | NO | PK |
| is_favorite | boolean | YES |  |
| last_read_at | timestamptz | YES |  |
| platform_book_id | uuid | YES |  |
| read_count | int | YES |  |
| reading_progress | text | YES |  |
| status | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"add37e5f-583b-4097-a5eb-95f253f128f1","user_id":"d8de59ae-da91-4885-acd8-2bf343d9583f","platform_book_id":"db25fc0e-8b2e-49bc-af01-416be4e57ba7","current_chapter_index":0,"reading_progress":0,"read_count":0,"last_read_at":null,"is_favorite":false,"status":"reading","added_at":"2026-02-21T03:53:54.586353+00:00","updated_at":"2026-02-21T03:53:54.586353+00:00"}]

```

</details>

---

## user_preferences

**行数：57**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| conversation_default_duration | text | YES |  |
| conversation_default_topic | text | YES |  |
| created_at | timestamptz | YES |  |
| daily_review_goal | text | YES |  |
| default_reading_mode | text | YES |  |
| enable_notifications | boolean | YES |  |
| enable_voice_input | boolean | YES |  |
| filter_stopwords_in_reading | boolean | YES |  |
| first | text | YES |  |
| fourth | text | YES |  |
| id | uuid | NO | PK |
| learning_pace | text | YES |  |
| metadata | jsonb | YES |  |
| min_coverage_percentage | text | YES |  |
| notification_time | text | YES |  |
| preferred_topics | array | YES |  |
| review_intervals | jsonb | YES |  |
| second | text | YES |  |
| target_library_id | uuid | YES |  |
| target_library_name | text | YES |  |
| third | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"41b6f09e-623f-42e7-bff4-376b826ccf9e","user_id":"8d3d65fc-13e9-40d1-960a-0c4652d1f841","preferred_topics":[],"learning_pace":"moderate","daily_review_goal":20,"review_intervals":{"first": 1, "third": 7, "fourth": 14, "second": 3},"enable_notifications":true,"notification_time":"09:00:00","conversation_default_topic":"","conversation_default_duration":10,"enable_voice_input":false,"metadata":{},"created_at":"2026-02-01T09:15:12.854526+00:00","updated_at":"2026-02-01T09:15:12.854526+00:00","target_library_id":null,"target_library_name":null,"filter_stopwords_in_reading":true,"min_coverage_percentage":15,"default_reading_mode":"selective"}]

```

</details>

---

## user_reading_fragments

**行数：90**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| ai_analysis | text | YES |  |
| char_offset_end | text | YES |  |
| char_offset_start | text | YES |  |
| context_sentence | text | YES |  |
| created_at | timestamptz | YES |  |
| id | uuid | NO | PK |
| material_id | uuid | YES |  |
| metadata | jsonb | YES |  |
| selected_text | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |
| user_note | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"5d8aa72e-ecd4-4e7f-a633-60c0c1fa3b6b","user_id":"a0d14b7a-6bdb-4fb3-81cb-3569127fecd4","material_id":"76331fb4-c628-4b9e-ba07-90659630f51f","selected_text":"Seven Becoming Who You Are\n\nChapter Eight","context_sentence":"Chapter Seven Becoming Who You Are\n\nChapter Eight How Do I Get Rich?","char_offset_start":417,"char_offset_end":458,"user_note":null,"ai_analysis":null,"metadata":{},"created_at":"2026-02-16T16:26:04.399125+00:00","updated_at":"2026-02-16T16:26:04.399125+00:00"}]

```

</details>

---

## user_reading_material_words

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## user_reading_materials

**行数：1042**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| book_id | uuid | YES |  |
| category | text | YES |  |
| chapter_index | text | YES |  |
| chapter_title | text | YES |  |
| content | jsonb | YES |  |
| created_at | timestamptz | YES |  |
| estimated_difficulty | text | YES |  |
| id | uuid | NO | PK |
| is_analyzed | boolean | YES |  |
| is_favorite | boolean | YES |  |
| is_platform | boolean | YES |  |
| last_read_at | timestamptz | YES |  |
| library_coverage | jsonb | YES |  |
| metadata | jsonb | YES |  |
| read_count | int | YES |  |
| sort_order | text | YES |  |
| source | text | YES |  |
| source_type | text | YES |  |
| source_url | text | YES |  |
| title | text | YES |  |
| title_zh | text | YES |  |
| topic | text | YES |  |
| total_words | text | YES |  |
| unique_words | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |
| words_to_learn_count | int | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"fbfa73b8-7b93-44b0-9df9-361d336cfdf5","user_id":null,"title":"Learning to Cook","content":"When I moved to a new city last year, I realized I needed to learn how to cook. Before that, I had always relied on my parents or restaurants for meals. But eating out every day was too expensive, and I missed the taste of home-cooked food.\r\n\r\nI started with something simple: fried eggs. It sounds easy, but my first attempt was a disaster. I heated the oil too much, and the egg turned completely black. The kitchen was filled with smoke, and the fire alarm went off. My neighbor knocked on my door to check if everything was okay.\r\n\r\nAfter that embarrassing experience, I decided to watch cooking videos online. I found a channel that taught basic dishes step by step. The instructor spoke slowly and clearly, which was perfect for me since I was also practicing my English at the same time.\r\n\r\nMy second dish was tomato and egg stir-fry. This time, I followed the recipe carefully. I cracked two eggs into a bowl and beat them with chopsticks. Then I cut the tomatoes into small pieces. I heated the pan, added a little oil, and poured in the eggs. When they were half cooked, I added the tomatoes, some salt, and a pinch of sugar.\r\n\r\nThe result was surprisingly good. It was not as delicious as my mother's version, but it was edible and I felt proud of myself.\r\n\r\nNow, six months later, I can cook more than ten different dishes. Cooking has become one of my favorite hobbies. It helps me relax after a long day of work, and I have even started inviting friends over for dinner.\r\n\r\nThe most important lesson I learned is that making mistakes is part of the process. Every burnt dish and every failed recipe taught me something new.","source_type":"import","source_url":null,"total_words":301,"unique_words":185,"library_coverage":{},"words_to_learn_count":0,"estimated_difficulty":3,"is_analyzed":false,"is_favorite":false,"read_count":0,"last_read_at":null,"metadata":{"
```

</details>

---

## user_vocabulary_libraries

**行数：53**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| daily_target | text | YES |  |
| id | uuid | NO | PK |
| is_active | boolean | YES |  |
| learned_words | text | YES |  |
| library_id | uuid | YES |  |
| mastered_words | text | YES |  |
| metadata | jsonb | YES |  |
| review_priority | text | YES |  |
| started_at | timestamptz | YES |  |
| target_completion_date | timestamptz | YES |  |
| total_words | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"8eacb88d-5559-421b-8aa4-aa9433c03428","user_id":"8d3d65fc-13e9-40d1-960a-0c4652d1f841","library_id":"a68fdde8-570b-4a05-a2a6-7351b3ad9983","is_active":false,"started_at":"2026-02-02T11:48:26.717+00:00","target_completion_date":null,"total_words":500,"learned_words":0,"mastered_words":0,"daily_target":20,"review_priority":5,"metadata":{},"created_at":"2026-02-02T11:48:27.402811+00:00","updated_at":"2026-02-02T11:49:05.471368+00:00"}]

```

</details>

---

## users

**行数：57**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| api_key_encrypted | text | YES |  |
| api_provider | text | YES |  |
| created_at | timestamptz | YES |  |
| display_name | text | YES |  |
| email | text | YES |  |
| id | uuid | NO | PK |
| last_active_date | timestamptz | YES |  |
| learning_streak_days | int | YES |  |
| metadata | jsonb | YES |  |
| subscription_expires_at | timestamptz | YES |  |
| subscription_tier | text | YES |  |
| total_conversations | text | YES |  |
| total_reviews | text | YES |  |
| updated_at | timestamptz | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"8d3d65fc-13e9-40d1-960a-0c4652d1f841","email":"2315235186@qq.com","display_name":"su","api_provider":null,"api_key_encrypted":null,"subscription_tier":"free","subscription_expires_at":null,"total_conversations":0,"total_reviews":0,"learning_streak_days":0,"last_active_date":null,"metadata":{},"created_at":"2026-02-01T09:15:12.854526+00:00","updated_at":"2026-02-01T09:15:12.854526+00:00"}]

```

</details>

---

## v_word_reading_stats

**行数：3603**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| estimated_level | int | YES |  |
| first_encounter_at | timestamptz | YES |  |
| last_encounter_at | timestamptz | YES |  |
| marked_materials | text | YES |  |
| selective_materials | text | YES |  |
| strict_materials | text | YES |  |
| total_encounters | text | YES |  |
| total_marked | text | YES |  |
| unique_materials | text | YES |  |
| user_id | uuid | YES |  |
| word | text | YES |  |
| word_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"word_id":"000a583d-7aa0-4684-8222-2a963eb93364","user_id":"b9d34dba-5ae7-43de-aaaa-d59f168400ee","word":"ring","estimated_level":4,"total_encounters":1,"total_marked":0,"unique_materials":1,"strict_materials":1,"selective_materials":0,"marked_materials":0,"last_encounter_at":"2026-02-23T15:25:27.666166+00:00","first_encounter_at":"2026-02-23T15:25:27.666166+00:00"}]

```

</details>

---

## vocabulary_index

**行数：8107**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| id | uuid | NO | PK |
| updated_at | timestamptz | YES |  |
| word | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"eb09dc9a-ea16-4448-b18b-047eff0e9bd4","word":"regarding","created_at":"2026-01-31T09:20:44.634985+00:00","updated_at":"2026-02-06T01:40:50.766923+00:00"}]

```

</details>

---

## vocabulary_libraries

**行数：14**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| category | text | YES |  |
| cefr_range | text | YES |  |
| code | text | YES |  |
| created_at | timestamptz | YES |  |
| description | text | YES |  |
| display_order | text | YES |  |
| id | uuid | NO | PK |
| is_active | boolean | YES |  |
| is_official | boolean | YES |  |
| metadata | jsonb | YES |  |
| name | text | YES |  |
| source | text | YES |  |
| target_level | int | YES |  |
| total_words | text | YES |  |
| updated_at | timestamptz | YES |  |
| version | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"7f8db215-42d7-4835-8cfd-add74e2741f5","name":"大学英语四级","code":"cet4","description":null,"total_words":4500,"target_level":null,"cefr_range":null,"category":"exam","is_official":true,"is_active":false,"version":null,"source":null,"display_order":20,"metadata":{},"created_at":"2026-01-31T08:28:04.059135+00:00","updated_at":"2026-02-12T02:44:42.986593+00:00"}]

```

</details>

---

## vocabulary_library_words

**行数：22621**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| id | uuid | NO | PK |
| importance | text | YES |  |
| index_id | uuid | YES |  |
| library_id | uuid | YES |  |
| meanings | array | YES |  |
| metadata | jsonb | YES |  |
| notes | jsonb | YES |  |
| pos | text | YES |  |
| sequence_number | text | YES |  |
| tags | array | YES |  |
| translation | text | YES |  |
| unit | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"0fd42df1-be85-4d92-bdb9-5f42409346a6","library_id":"73118593-bcdf-4f75-98f4-da96be99416a","index_id":"cf700dde-85cb-41f7-8675-f9c1f851dd33","importance":null,"sequence_number":1,"unit":null,"tags":[],"metadata":{"notes": "As defined in 大学英语六级词汇", "meanings": [{"pos": "n", "translation": "放弃"}]},"created_at":"2026-01-31T09:20:49.254041+00:00"}]

```

</details>

---

## word_classifications

**行数：68**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| created_at | timestamptz | YES |  |
| id | uuid | NO | PK |
| is_basic | boolean | YES |  |
| is_stopword | boolean | YES |  |
| word | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"3d9a0cd2-03cb-4456-b507-e5f6c52f796f","word":"she","is_stopword":true,"is_basic":false,"created_at":"2026-02-21T02:25:27.091953+00:00"}]

```

</details>

---

## word_distractors

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## word_history

**行数：4961**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| context_sentence | text | YES |  |
| created_at | timestamptz | YES |  |
| event_type | text | YES |  |
| friction | boolean | YES |  |
| friction_note | text | YES |  |
| id | uuid | NO | PK |
| is_correct | boolean | YES |  |
| material_id | uuid | YES |  |
| metadata | jsonb | YES |  |
| new_interval | text | YES |  |
| practice_type | text | YES |  |
| quality | text | YES |  |
| reading_mode | text | YES |  |
| response_time_ms | text | YES |  |
| source_id | uuid | YES |  |
| source_type | text | YES |  |
| user_id | uuid | YES |  |
| word_id | uuid | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"f72f2f32-6c4f-4041-adac-da58c0e8d566","word_id":"7c48748e-1d87-4cf9-a1ca-cece872182af","user_id":"a0d14b7a-6bdb-4fb3-81cb-3569127fecd4","event_type":"review_correct","is_correct":true,"response_time_ms":7685,"source_type":"quiz","source_id":null,"friction":false,"friction_note":null,"metadata":{"quality": 3, "new_interval": 1},"created_at":"2026-02-12T03:16:19.701004+00:00","practice_type":null,"reading_mode":null,"material_id":null,"context_sentence":null}]

```

</details>

---

## word_relations

**行数：0**

*表为空或无数据*

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[]

```

</details>

---

## words

**行数：3603**

| 字段 | 类型 | 可空 | 主键 |
|------|------|------|------|
| categories | array | YES |  |
| context | jsonb | YES |  |
| correct_reviews | text | YES |  |
| created_at | timestamptz | YES |  |
| difficulty_level | int | YES |  |
| easiness_factor | float | YES |  |
| estimated_level | int | YES |  |
| estimated_level_source | text | YES |  |
| estimated_level_updated_at | timestamptz | YES |  |
| first_seen | text | YES |  |
| id | uuid | NO | PK |
| index_id | uuid | YES |  |
| interval_days | int | YES |  |
| last_reviewed_at | timestamptz | YES |  |
| library_sources | array | YES |  |
| metadata | jsonb | YES |  |
| next_review_date | timestamptz | YES |  |
| notes | jsonb | YES |  |
| phonetic | text | YES |  |
| pos | text | YES |  |
| repetition_count | int | YES |  |
| source_id | uuid | YES |  |
| source_type | text | YES |  |
| status | text | YES |  |
| total_reviews | text | YES |  |
| translation | text | YES |  |
| updated_at | timestamptz | YES |  |
| user_id | uuid | YES |  |
| word | text | YES |  |

<details>
<summary>扩展信息</summary>

**原始数据样本：**
```json
[{"id":"35ce9a90-1091-4084-a621-3ee7cb25b453","user_id":"b0890746-303b-410b-8c93-89dfe712691b","word":"abandon","phonetic":"//əˈbændən//","translation":"放任；狂热","pos":null,"status":"learning","context":null,"notes":null,"source_type":null,"source_id":null,"first_seen":"2026-02-13T03:44:23.214084+00:00","categories":[],"difficulty_level":null,"total_reviews":1,"correct_reviews":1,"last_reviewed_at":"2026-02-13T03:44:22.119+00:00","next_review_date":null,"metadata":{},"created_at":"2026-02-13T03:44:23.214084+00:00","updated_at":"2026-02-13T03:44:23.214084+00:00","index_id":"3f156e96-6add-41f5-9b08-f035fb107cdd","library_sources":[],"estimated_level":2,"estimated_level_updated_at":"2026-02-13T03:44:22.119+00:00","estimated_level_source":"quiz","easiness_factor":2.5,"interval_days":0,"repetition_count":0}]

```

</details>

---

