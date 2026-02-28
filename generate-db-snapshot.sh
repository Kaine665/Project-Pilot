#!/bin/bash

SUPABASE_URL="http://81.68.249.18:8100"
SUPABASE_KEY="eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc3MDQ0OTk0MywgImV4cCI6IDIwODU4MDk5NDN9.c93Eb3linNGsiZj7dEb7PSR4ko7pDNuwbs62Ps5xyB0"

OUTPUT_FILE="docs/db-snapshot.md"
mkdir -p docs

# 表列表
tables=(
  "app_releases"
  "archive"
  "books"
  "conversation_messages"
  "conversations"
  "dict_curated"
  "dict_ecdict"
  "exercise_results"
  "exercises"
  "feedback"
  "grammar_history"
  "grammar_rules"
  "knowledge_domains"
  "knowledge_points"
  "phrases"
  "platform_book_chapters"
  "platform_books"
  "review_queue"
  "sentences"
  "user_books"
  "user_preferences"
  "user_reading_fragments"
  "user_reading_material_words"
  "user_reading_materials"
  "user_vocabulary_libraries"
  "users"
  "v_word_reading_stats"
  "vocabulary_index"
  "vocabulary_libraries"
  "vocabulary_library_words"
  "word_classifications"
  "word_distractors"
  "word_history"
  "word_relations"
  "words"
)

echo "# 数据库快照

> 获取时间：$(date '+%Y-%m-%d %H:%M:%S')
> 数据库：ELApp 生产环境 (http://81.68.249.18:8100)
> 表总数：${#tables[@]}

## 概览

| # | 表名 | 行数 | 字段数 | 说明 |
|---|------|------|--------|------|" > "$OUTPUT_FILE"

# 收集所有表的信息
for i in "${!tables[@]}"; do
  table="${tables[$i]}"
  idx=$((i + 1))

  response=$(curl -s -i -X GET "${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Prefer: count=exact" 2>/dev/null)

  # 提取行数
  count=$(echo "$response" | grep -o 'Content-Range: .*/[0-9]*' | grep -o '[0-9]*$' || echo "0")

  # 提取字段（从 JSON 数据中提取键名）
  json_data=$(echo "$response" | tail -1)
  if [ "$json_data" != "[]" ] && [ -n "$json_data" ]; then
    # 提取第一个对象的字段名
    fields=$(echo "$json_data" | grep -o '"[a-z_]*":' | sed 's/"//g; s/://' | sort -u)
    field_count=$(echo "$fields" | wc -l)
  else
    field_count="0"
  fi

  echo "| ${idx} | ${table} | ${count} | ${field_count} | - |" >> "$OUTPUT_FILE"
  echo "已处理: ${table} (${count} 行, ${field_count} 字段)"
done

echo "" >> "$OUTPUT_FILE"
echo "---" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# 详细表结构
for table in "${tables[@]}"; do
  echo "## ${table}" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  response=$(curl -s -i -X GET "${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Prefer: count=exact" 2>/dev/null)

  # 提取行数
  count=$(echo "$response" | grep -o 'Content-Range: .*/[0-9]*' | grep -o '[0-9]*$' || echo "0")
  echo "**行数：${count}**" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  # 提取字段信息
  json_data=$(echo "$response" | tail -1)
  if [ "$json_data" != "[]" ] && [ -n "$json_data" ]; then
    echo "| 字段 | 类型 | 可空 | 主键 |" >> "$OUTPUT_FILE"
    echo "|------|------|------|------|" >> "$OUTPUT_FILE"

    # 提取字段名并推断类型
    fields=$(echo "$json_data" | grep -o '"[a-z_]*":' | sed 's/"//g; s/://' | sort -u)

    for field in $fields; do
      # 推断类型
      value=$(echo "$json_data" | grep -oP "\"${field}\":\s*\"?[^,\}]*\"?" | head -1 | sed "s/\"${field}\":\s*//")

      if [[ "$field" == "id" ]]; then
        type="uuid"
        nullable="NO"
        pk="PK"
      elif [[ "$field" == *"_id" ]]; then
        type="uuid"
        nullable="YES"
        pk=""
      elif [[ "$field" == *"_at" ]] || [[ "$field" == *"_date" ]]; then
        type="timestamptz"
        nullable="YES"
        pk=""
      elif [[ "$field" == "metadata" ]] || [[ "$field" == "data" ]] || [[ "$field" == "context" ]] || [[ "$field" == "notes" ]] || [[ "$field" == "content" ]]; then
        type="jsonb"
        nullable="YES"
        pk=""
      elif [[ "$field" == *"_count" ]] || [[ "$field" == *"_level" ]] || [[ "$field" == *"_days" ]] || [[ "$field" == *"_streak" ]]; then
        type="int"
        nullable="YES"
        pk=""
      elif [[ "$field" == *"_factor" ]]; then
        type="float"
        nullable="YES"
        pk=""
      elif [[ "$value" == "true" ]] || [[ "$value" == "false" ]]; then
        type="boolean"
        nullable="YES"
        pk=""
      elif [[ "$value" == \[* ]]; then
        type="array"
        nullable="YES"
        pk=""
      elif [[ "$value" == \{* ]]; then
        type="jsonb"
        nullable="YES"
        pk=""
      else
        type="text"
        nullable="YES"
        pk=""
      fi

      echo "| ${field} | ${type} | ${nullable} | ${pk} |" >> "$OUTPUT_FILE"
    done
  else
    echo "*表为空或无数据*" >> "$OUTPUT_FILE"
  fi

  echo "" >> "$OUTPUT_FILE"
  echo "<details>" >> "$OUTPUT_FILE"
  echo "<summary>扩展信息</summary>" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "**原始数据样本：**" >> "$OUTPUT_FILE"
  echo '```json' >> "$OUTPUT_FILE"
  echo "$json_data" | head -c 2000 >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo '```' >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "</details>" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"
  echo "---" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

done

echo "数据库快照已生成: $OUTPUT_FILE"
