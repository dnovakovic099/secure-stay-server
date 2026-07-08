-- quoConversationId inherited the ai_message_suggestions table default
-- (utf8mb4_general_ci), but quo_conversations/quo_messages.conversationId are
-- utf8mb4_unicode_ci — the analytics joins failed with "Illegal mix of
-- collations". Align the column with the quo tables. Idempotent.
ALTER TABLE `ai_message_suggestions`
  MODIFY `quoConversationId` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
