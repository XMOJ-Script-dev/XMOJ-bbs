-- Migration number: 0000 	 2023-12-30T11:26:45.725Z

CREATE TABLE IF NOT EXISTS badge (
    user_id TEXT PRIMARY KEY NOT NULL,
    background_color TEXT NOT NULL DEFAULT "#000000",
    color TEXT NOT NULL DEFAULT "#ffffff",
    content TEXT NOT NULL DEFAULT "VIP"
);

CREATE TABLE IF NOT EXISTS bbs_lock (
    post_id INTEGER PRIMARY KEY NOT NULL,
    lock_person TEXT NOT NULL,
    lock_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bbs_mention (
    bbs_mention_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    to_user_id TEXT NOT NULL,
    post_id INTEGER NOT NULL,
    bbs_mention_time TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS bbs_post (
    post_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    problem_id INT NOT NULL,
    title TEXT NOT NULL,
    post_time INTEGER NOT NULL,
    board_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bbs_reply (
    reply_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_time INTEGER NOT NULL,
    edit_time INTEGER,
    edit_person TEXT
);

CREATE TABLE IF NOT EXISTS bbs_board (
    board_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    board_name TEXT NOT NULL
);
INSERT INTO bbs_board (board_name) VALUES ('站务版');
INSERT INTO bbs_board (board_name) VALUES ('学术版');
INSERT INTO bbs_board (board_name) VALUES ('灌水区');
INSERT INTO bbs_board (board_name) VALUES ('反馈区');
INSERT INTO bbs_board (board_name) VALUES ('题目总版');

CREATE TABLE IF NOT EXISTS phpsessid (
    token TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    create_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS short_message (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    message_from TEXT NOT NULL,
    message_to TEXT NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    send_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS short_message_mention (
    mail_mention_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    mail_mention_time TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS std_answer (
    problem_id INTEGER PRIMARY KEY NOT NULL,
    std_code TEXT
);

