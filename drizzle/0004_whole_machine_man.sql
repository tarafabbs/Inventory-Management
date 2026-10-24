CREATE TABLE `ground_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pieces` ADD `ground_staff_id` text REFERENCES ground_staff(id);
--> statement-breakpoint
DROP TRIGGER piece_state_insert;
--> statement-breakpoint
DROP TRIGGER piece_state_update;
--> statement-breakpoint
CREATE TRIGGER piece_state_insert BEFORE INSERT ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','GROUND_STAFF','EXCEPTION','RETURNED_TO_SOURCE') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR (NEW.holder='GROUND_STAFF' AND NEW.ground_staff_id IS NULL) OR (NEW.holder!='GROUND_STAFF' AND NEW.ground_staff_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED','DISPUTED','REPRINTING','FINISHING','FINISHED') OR (NEW.condition!='PENDING_LABEL_CONFIRMATION' AND NEW.label_confirmed_at IS NULL) OR (NEW.condition='REPRINTING' AND NEW.holder!='WITH_ARTISAN') OR (NEW.condition='FINISHING' AND NEW.holder!='GROUND_STAFF') OR (NEW.condition='FINISHED' AND NEW.holder!='IN_HOUSE') BEGIN SELECT RAISE(ABORT, 'Invalid warehouse custody, stage or label state'); END;
--> statement-breakpoint
CREATE TRIGGER piece_state_update BEFORE UPDATE ON pieces WHEN NEW.holder NOT IN ('IN_HOUSE','WITH_ARTISAN','GROUND_STAFF','EXCEPTION','RETURNED_TO_SOURCE') OR (NEW.holder='WITH_ARTISAN' AND NEW.artisan_id IS NULL) OR (NEW.holder!='WITH_ARTISAN' AND NEW.artisan_id IS NOT NULL) OR (NEW.holder='GROUND_STAFF' AND NEW.ground_staff_id IS NULL) OR (NEW.holder!='GROUND_STAFF' AND NEW.ground_staff_id IS NOT NULL) OR NEW.condition NOT IN ('PENDING_LABEL_CONFIRMATION','AVAILABLE','ACCEPTED_WORK','NEEDS_REWORK','DAMAGED','DISPUTED','REPRINTING','FINISHING','FINISHED') OR (NEW.condition!='PENDING_LABEL_CONFIRMATION' AND NEW.label_confirmed_at IS NULL) OR (OLD.holder='RETURNED_TO_SOURCE' AND NEW.holder!='RETURNED_TO_SOURCE') OR (NEW.condition='REPRINTING' AND NEW.holder!='WITH_ARTISAN') OR (NEW.condition='FINISHING' AND NEW.holder!='GROUND_STAFF') OR (NEW.condition='FINISHED' AND NEW.holder!='IN_HOUSE') BEGIN SELECT RAISE(ABORT, 'Invalid warehouse custody, stage or completed source return'); END;
--> statement-breakpoint
CREATE INDEX piece_ground_staff_idx ON pieces(ground_staff_id);
