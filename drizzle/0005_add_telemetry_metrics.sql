CREATE TABLE "TelemetryMetric" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"tool_profile_id" text,
	"vendor" text NOT NULL,
	"service_name" text,
	"metric_name" text NOT NULL,
	"metric_type" text NOT NULL,
	"unit" text,
	"description" text,
	"attributes" jsonb,
	"value_double" double precision,
	"value_int" integer,
	"count" integer,
	"sum" double precision,
	"min" double precision,
	"max" double precision,
	"bucket_counts" jsonb,
	"explicit_bounds" jsonb,
	"quantile_values" jsonb,
	"data_point" jsonb,
	"start_time" timestamp with time zone,
	"time" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "TelemetryMetric" ADD CONSTRAINT "TelemetryMetric_customer_id_Customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetryMetric" ADD CONSTRAINT "TelemetryMetric_partner_id_Partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."Partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetryMetric" ADD CONSTRAINT "TelemetryMetric_tool_profile_id_ToolProfile_id_fk" FOREIGN KEY ("tool_profile_id") REFERENCES "public"."ToolProfile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "TelemetryMetric_customer_id_idx" ON "TelemetryMetric" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "TelemetryMetric_tool_profile_id_idx" ON "TelemetryMetric" USING btree ("tool_profile_id");--> statement-breakpoint
CREATE INDEX "TelemetryMetric_vendor_idx" ON "TelemetryMetric" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "TelemetryMetric_metric_name_idx" ON "TelemetryMetric" USING btree ("metric_name");--> statement-breakpoint
CREATE INDEX "TelemetryMetric_time_idx" ON "TelemetryMetric" USING btree ("time");
