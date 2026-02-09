CREATE TABLE "TelemetryLog" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"tool_profile_id" text,
	"vendor" text NOT NULL,
	"trace_id" text,
	"span_id" text,
	"severity" text,
	"body" text,
	"resource_attributes" jsonb,
	"log_attributes" jsonb,
	"timestamp" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "TelemetrySpan" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"tool_profile_id" text,
	"trace_id" text NOT NULL,
	"span_id" text NOT NULL,
	"parent_span_id" text,
	"span_name" text NOT NULL,
	"span_kind" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"duration_ms" integer,
	"status_code" text,
	"status_message" text,
	"vendor" text NOT NULL,
	"service_name" text,
	"resource_attributes" jsonb,
	"span_attributes" jsonb,
	"signal_type" text DEFAULT 'trace',
	"ingested_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ToolProfile" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"vendor" text NOT NULL,
	"display_name" text NOT NULL,
	"logo_url" text,
	"vendor_category" text,
	"total_spans" integer DEFAULT 0 NOT NULL,
	"total_traces" integer DEFAULT 0 NOT NULL,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "Customer" ALTER COLUMN "billing_status" SET DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE "TelemetryLog" ADD CONSTRAINT "TelemetryLog_customer_id_Customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetryLog" ADD CONSTRAINT "TelemetryLog_tool_profile_id_ToolProfile_id_fk" FOREIGN KEY ("tool_profile_id") REFERENCES "public"."ToolProfile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetrySpan" ADD CONSTRAINT "TelemetrySpan_customer_id_Customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetrySpan" ADD CONSTRAINT "TelemetrySpan_partner_id_Partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."Partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TelemetrySpan" ADD CONSTRAINT "TelemetrySpan_tool_profile_id_ToolProfile_id_fk" FOREIGN KEY ("tool_profile_id") REFERENCES "public"."ToolProfile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ToolProfile" ADD CONSTRAINT "ToolProfile_customer_id_Customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."Customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ToolProfile" ADD CONSTRAINT "ToolProfile_partner_id_Partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."Partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "TelemetryLog_customer_id_idx" ON "TelemetryLog" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "TelemetryLog_vendor_idx" ON "TelemetryLog" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "TelemetryLog_timestamp_idx" ON "TelemetryLog" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "TelemetrySpan_customer_vendor_time_idx" ON "TelemetrySpan" USING btree ("customer_id","vendor","start_time");--> statement-breakpoint
CREATE INDEX "TelemetrySpan_trace_id_idx" ON "TelemetrySpan" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "TelemetrySpan_tool_profile_id_idx" ON "TelemetrySpan" USING btree ("tool_profile_id");--> statement-breakpoint
CREATE INDEX "TelemetrySpan_start_time_idx" ON "TelemetrySpan" USING btree ("start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "ToolProfile_customer_vendor_idx" ON "ToolProfile" USING btree ("customer_id","vendor");