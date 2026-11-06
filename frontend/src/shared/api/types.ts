// Type contracts mirroring the FastAPI Pydantic models.

export type AppName = "questionnaire" | "support" | "study";

export type ArtifactStatus = "uploading" | "queued" | "processing" | "indexed" | "failed";

export interface Artifact {
  id: string;
  tenant_id: string;
  app: AppName;
  scope: string;
  filename: string;
  content_type: string;
  source_url: string | null;
  size_bytes: number;
  sha256: string;
  status: ArtifactStatus;
  progress: number;
  chunk_count: number;
  error: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  tenant_id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadResponse {
  artifact: Artifact;
  job: Job;
}

export interface Citation {
  chunk_id: string;
  source: string;
  location: string;
  quote: string;
}

export interface RetrievedChunk {
  id: string;
  artifact_id: string;
  source: string;
  location: string;
  text: string;
  score: number;
}

export interface Health {
  status: string;
  environment: string;
  storage: string;
  llm: string;
  embeddings: string;
}

// ---------------------------------------------------------------- Questionnaire Autopilot

export type Confidence = "high" | "review" | "unsure" | "pending";

export interface QuestionRow {
  id: string;
  ref: string;
  category: string;
  question: string;
  answer: string;
  confidence: Confidence;
  citations: Citation[];
  reasoning: string;
  edited: boolean;
  approved: boolean;
  updated_at: string;
}

export interface Questionnaire {
  id: string;
  tenant_id: string;
  name: string;
  customer: string;
  due_date: string | null;
  rows: QuestionRow[];
  last_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionnaireSummary {
  id: string;
  name: string;
  customer: string;
  due_date: string | null;
  total: number;
  answered: number;
  high: number;
  review: number;
  unsure: number;
  approved: number;
  updated_at: string;
}

export interface QuestionInput {
  ref: string;
  category: string;
  question: string;
}

export interface RowPatch {
  answer?: string;
  confidence?: Exclude<Confidence, "pending">;
  approved?: boolean;
}

export interface AutofillResponse {
  job: Job;
  questionnaire_id: string;
}

// ---------------------------------------------------------------- Site Support Agent

export interface Whitelabel {
  enabled: boolean;
  brand_name: string;
  hide_powered_by: boolean;
  custom_domain: string;
  client_label: string;
}

export interface UrlSource {
  id: string;
  url: string;
  max_pages: number;
  status: "queued" | "crawling" | "indexed" | "failed";
  pages: string[];
  artifact_ids: string[];
  job_id: string | null;
  error: string | null;
  last_crawled_at: string | null;
}

export type Tone = "friendly" | "concise" | "formal";

export interface Widget {
  id: string;
  tenant_id: string;
  name: string;
  primary_color: string;
  position: "right" | "left";
  greeting: string;
  placeholder: string;
  tone: Tone;
  slack_webhook_url: string;
  slack_channel_label: string;
  escalation_email: string;
  escalate_on_low_confidence: boolean;
  allowed_origins: string[];
  whitelabel: Whitelabel;
  sources: UrlSource[];
  public_key: string;
  slack_configured: boolean;
  created_at: string;
  updated_at: string;
}

export type WidgetPatch = Partial<
  Pick<
    Widget,
    | "name"
    | "primary_color"
    | "position"
    | "greeting"
    | "placeholder"
    | "tone"
    | "slack_webhook_url"
    | "slack_channel_label"
    | "escalation_email"
    | "escalate_on_low_confidence"
    | "allowed_origins"
    | "whitelabel"
  >
>;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SupportChatResponse {
  answer: string;
  confidence: "high" | "low";
  needs_escalation: boolean;
  citations: Citation[];
  suggested_followups: string[];
}

export interface PublicWidgetConfig {
  name: string;
  primary_color: string;
  position: string;
  greeting: string;
  placeholder: string;
  brand_name: string;
  show_powered_by: boolean;
}

export interface Ticket {
  id: string;
  tenant_id: string;
  widget_id: string;
  session_id: string;
  email: string;
  note: string;
  transcript: ChatMessage[];
  status: "open" | "closed";
  slack_delivered: boolean;
  created_at: string;
}

export interface IngestResponse {
  job: Job;
  widget: Widget;
}

// ---------------------------------------------------------------- Study Copilot

export interface Topic {
  id: string;
  title: string;
  order: number;
  mastery: number;
  attempts: number;
  correct: number;
  cards_reviewed: number;
}

export interface Course {
  id: string;
  tenant_id: string;
  title: string;
  code: string;
  topics: Topic[];
  overall_mastery: number;
  created_at: string;
  updated_at: string;
}

export interface Flashcard {
  id: string;
  tenant_id: string;
  course_id: string;
  topic_id: string | null;
  front: string;
  back: string;
  citation: Citation | null;
  reviews: number;
  last_grade: "again" | "good" | "easy" | null;
  created_at: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  topic_id: string | null;
  answered_index: number | null;
  correct_index: number | null;
  explanation: string | null;
  citation: Citation | null;
}

export interface Quiz {
  id: string;
  course_id: string;
  topic_id: string | null;
  questions: QuizQuestion[];
  created_at: string;
}

export interface AnswerResult {
  correct: boolean;
  correct_index: number;
  explanation: string;
  citation: Citation | null;
  topic_id: string | null;
  topic_mastery: number | null;
  course_mastery: number;
}

export interface StudyChatResponse {
  answer: string;
  citations: Citation[];
}
