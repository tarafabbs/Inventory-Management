CREATE TABLE `artisans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`ownership` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_prefix_unique` ON `companies` (`prefix`);--> statement-breakpoint
CREATE TABLE `piece_events` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`type` text NOT NULL,
	`transaction_id` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`before_state` text,
	`after_state` text NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`resolution` text
);
--> statement-breakpoint
CREATE TABLE `guards` (
	`id` text PRIMARY KEY NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_piece_unique` ON `transaction_items` (`transaction_id`,`piece_id`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`ownership` text NOT NULL,
	`received_at` text NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`stated` integer NOT NULL,
	`accepted` integer NOT NULL,
	`damaged` integer NOT NULL,
	`rejected` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lots_number_unique` ON `lots` (`number`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`check_id` text NOT NULL,
	`code` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `stock_checks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observation_unique` ON `observations` (`check_id`,`code`);--> statement-breakpoint
CREATE TABLE `pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`ownership` text NOT NULL,
	`holder` text NOT NULL,
	`artisan_id` text,
	`condition` text NOT NULL,
	`label_confirmed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artisan_id`) REFERENCES `artisans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pieces_code_unique` ON `pieces` (`code`);--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`codes` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`weave` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`design` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`operation` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`expected` text NOT NULL,
	`status` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`artisan_id` text,
	`status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`original_id` text,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`artisan_id`) REFERENCES `artisans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_number_unique` ON `transactions` (`number`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TRIGGER guard_valid BEFORE INSERT ON guards WHEN NEW.ok != 1 BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: stale state guards'); END;
--> statement-breakpoint
CREATE TRIGGER piece_identity_immutable BEFORE UPDATE OF id,code,company_id,product_id,lot_id,ownership ON pieces BEGIN SELECT RAISE(ABORT, 'Piece identity and original source are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER piece_no_delete BEFORE DELETE ON pieces BEGIN SELECT RAISE(ABORT, 'Pieces cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER event_no_update BEFORE UPDATE ON piece_events BEGIN SELECT RAISE(ABORT, 'History is append only'); END;
--> statement-breakpoint
CREATE TRIGGER event_no_delete BEFORE DELETE ON piece_events BEGIN SELECT RAISE(ABORT, 'History is append only'); END;
--> statement-breakpoint
CREATE TRIGGER prefix_immutable BEFORE UPDATE OF prefix,ownership ON companies WHEN OLD.prefix!=NEW.prefix OR OLD.ownership!=NEW.ownership BEGIN SELECT RAISE(ABORT, 'Company prefix and ownership are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prefix_reserved BEFORE DELETE ON companies BEGIN SELECT RAISE(ABORT, 'Company prefixes are reserved forever; archive instead'); END;
--> statement-breakpoint
CREATE TRIGGER sequence_monotonic BEFORE UPDATE OF sequence ON companies WHEN NEW.sequence<OLD.sequence BEGIN SELECT RAISE(ABORT, 'Sequence cannot decrease'); END;
--> statement-breakpoint
CREATE TRIGGER piece_state_insert BEFORE INSERT ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','EXCEPTION') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED') BEGIN SELECT RAISE(ABORT, 'Invalid custody or condition'); END;
--> statement-breakpoint
CREATE TRIGGER piece_state_update BEFORE UPDATE ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','EXCEPTION') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED') OR (NEW.condition!='PENDING_LABEL_CONFIRMATION' AND NEW.label_confirmed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'Invalid custody, condition, or unconfirmed label'); END;
--> statement-breakpoint
CREATE INDEX piece_lot_idx ON pieces(lot_id);
--> statement-breakpoint
CREATE INDEX piece_artisan_idx ON pieces(artisan_id);
--> statement-breakpoint
CREATE INDEX event_piece_idx ON piece_events(piece_id,created_at);
