CREATE TABLE `user` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `email` text NOT NULL UNIQUE, `email_verified` integer DEFAULT 0 NOT NULL, `image` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `session` (`id` text PRIMARY KEY NOT NULL, `expires_at` integer NOT NULL, `token` text NOT NULL UNIQUE, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, `ip_address` text, `user_agent` text, `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);
--> statement-breakpoint
CREATE TABLE `account` (`id` text PRIMARY KEY NOT NULL, `account_id` text NOT NULL, `provider_id` text NOT NULL, `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE, `access_token` text, `refresh_token` text, `id_token` text, `access_token_expires_at` integer, `refresh_token_expires_at` integer, `scope` text, `password` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);
--> statement-breakpoint
CREATE TABLE `verification` (`id` text PRIMARY KEY NOT NULL, `identifier` text NOT NULL, `value` text NOT NULL, `expires_at` integer NOT NULL, `created_at` integer, `updated_at` integer);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);

