CREATE TABLE `generated_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`ownership` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	`registered_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_labels_code_unique` ON `generated_labels` (`code`);
--> statement-breakpoint
DROP TRIGGER piece_state_insert;
--> statement-breakpoint
DROP TRIGGER piece_state_update;
--> statement-breakpoint
CREATE TRIGGER piece_state_insert BEFORE INSERT ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','EXCEPTION','RETURNED_TO_SOURCE') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED','DISPUTED') OR (NEW.condition!='PENDING_LABEL_CONFIRMATION' AND NEW.label_confirmed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'Invalid custody, condition, or unconfirmed label'); END;
--> statement-breakpoint
CREATE TRIGGER piece_state_update BEFORE UPDATE ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','EXCEPTION','RETURNED_TO_SOURCE') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED','DISPUTED') OR (NEW.condition!='PENDING_LABEL_CONFIRMATION' AND NEW.label_confirmed_at IS NULL) OR (OLD.holder='RETURNED_TO_SOURCE' AND NEW.holder!='RETURNED_TO_SOURCE') BEGIN SELECT RAISE(ABORT, 'Invalid custody, condition, unconfirmed label, or completed source return'); END;
--> statement-breakpoint
CREATE TRIGGER generated_label_identity_immutable BEFORE UPDATE OF id,code,company_id,product_id,lot_id,ownership ON generated_labels BEGIN SELECT RAISE(ABORT, 'Generated barcode identity and source are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generated_label_no_delete BEFORE DELETE ON generated_labels BEGIN SELECT RAISE(ABORT, 'Generated barcode records cannot be deleted'); END;
