import { sqliteTable, AnySQLiteColumn, text, integer, index, numeric } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const badge = sqliteTable("badge", {
	userId: text("user_id").primaryKey().notNull(),
	backgroundColor: text("background_color").default(sql`'#000000'`).notNull(),
	color: text("color").default(sql`'#ffffff'`).notNull(),
	content: text("content").default(sql`'VIP'`).notNull(),
});

export const bbsLock = sqliteTable("bbs_lock", {
	postId: integer("post_id").primaryKey().notNull(),
	lockPerson: text("lock_person").notNull(),
	lockTime: integer("lock_time").notNull(),
});

export const bbsMention = sqliteTable("bbs_mention", {
	bbsMentionId: integer("bbs_mention_id").primaryKey({ autoIncrement: true }).notNull(),
	toUserId: text("to_user_id").notNull(),
	postId: integer("post_id").notNull(),
	bbsMentionTime: numeric("bbs_mention_time").notNull(),
	replyId: integer("reply_id").default(0).notNull(),
},
(table) => [
	index("idx_bbs_mention_to_user_id").on(table.toUserId),
]);

export const bbsPost = sqliteTable("bbs_post", {
	postId: integer("post_id").primaryKey({ autoIncrement: true }).notNull(),
	userId: text("user_id").notNull(),
	problemId: integer("problem_id").notNull(),
	title: text().notNull(),
	postTime: integer("post_time").notNull(),
	boardId: integer("board_id").notNull(),
});

export const bbsReply = sqliteTable("bbs_reply", {
	replyId: integer("reply_id").primaryKey({ autoIncrement: true }).notNull(),
	postId: integer("post_id").notNull(),
	userId: text("user_id").notNull(),
	content: text().notNull(),
	replyTime: integer("reply_time").notNull(),
	editTime: integer("edit_time"),
	editPerson: text("edit_person"),
},
(table) => [
	index("idx_bbs_reply").on(table.postId),
]);

export const bbsBoard = sqliteTable("bbs_board", {
	boardId: integer("board_id").primaryKey().notNull(),
	boardName: text("board_name").notNull(),
});

export const shortMessage = sqliteTable("short_message", {
	messageId: integer("message_id").primaryKey({ autoIncrement: true }).notNull(),
	messageFrom: text("message_from").notNull(),
	messageTo: text("message_to").notNull(),
	content: text().notNull(),
	isRead: integer("is_read").default(0).notNull(),
	sendTime: integer("send_time").notNull(),
});

export const shortMessageMention = sqliteTable("short_message_mention", {
	mailMentionId: integer("mail_mention_id").primaryKey({ autoIncrement: true }).notNull(),
	fromUserId: text("from_user_id").notNull(),
	toUserId: text("to_user_id").notNull(),
	mailMentionTime: numeric("mail_mention_time").notNull(),
},
(table) => [
	index("idx_short_message_mention_to_user_id").on(table.toUserId),
]);

export const stdAnswer = sqliteTable("std_answer", {
	problemId: integer("problem_id").primaryKey().notNull(),
	stdCode: text("std_code"),
});

export const phpsessid = sqliteTable("phpsessid", {
	token: text(),
	userId: text("user_id"),
	createTime: integer("create_time"),
},
(table) => [
	index("idx_phpsessid").on(table.token),
]);
