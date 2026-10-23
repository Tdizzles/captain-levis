-- 003_inquiry_details: structured answers from the website chat's quote flow (job type, the job's follow-up
-- questions, where on the boat, size, where she is, timing). Shape: lib/chat/quoteflow.ts InquiryDetails.
-- Form inquiries keep the empty object.

ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
