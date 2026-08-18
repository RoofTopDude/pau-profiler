import type {
  AnalysisMode,
  ContextCategory,
  ContextSegmentInput,
  NormalizeTraceOptions,
  PAUTrace,
  TraceFormat
} from "./types.js";

interface MessageLike {
  role?: unknown;
  content?: unknown;
  name?: unknown;
  tool_call_id?: unknown;
  tool_calls?: unknown;
}

export function detectTraceFormat(input: unknown): Exclude<TraceFormat, "auto"> {
  const value = parseUnknown(input);
  if (isRecord(value) && Array.isArray(value.segments)) return "pau";

  const messages = extractMessages(value);
  if (messages) {
    for (const message of messages) {
      if (!isRecord(message) || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (isRecord(block) && ["tool_use", "tool_result"].includes(String(block.type))) {
          return "anthropic";
        }
      }
    }
    if (isRecord(value) && value.system !== undefined) return "anthropic";
    return "openai";
  }

  throw new Error("Unable to detect trace format. Provide a PAU trace or a message array.");
}

export function normalizeTrace(input: unknown, options: NormalizeTraceOptions = {}): PAUTrace {
  const value = parseUnknown(input);
  const format = options.format && options.format !== "auto"
    ? options.format
    : detectTraceFormat(value);

  if (format === "pau") return normalizePAUTrace(value, options);
  if (format === "anthropic") return anthropicToTrace(value, options);
  return messagesToTrace(value, options, format);
}

export function openAIToTrace(input: unknown, options: NormalizeTraceOptions = {}): PAUTrace {
  return messagesToTrace(parseUnknown(input), { ...options, format: "openai" }, "openai");
}

export function anthropicToTrace(input: unknown, options: NormalizeTraceOptions = {}): PAUTrace {
  const value = parseUnknown(input);
  const messages = extractMessages(value);
  if (!messages) throw new Error("Anthropic input must provide a messages array.");
  const segments: ContextSegmentInput[] = [];

  if (isRecord(value) && value.system !== undefined) {
    const systemText = contentToText(value.system);
    if (systemText) {
      segments.push({
        id: "system.0",
        type: "system",
        source: "anthropic.system",
        content: systemText,
        protected: true,
        metadata: { originalRole: "system" }
      });
    }
  }

  const lastUserIndex = findLastRole(messages, "user");
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const raw = messages[messageIndex];
    if (!isRecord(raw)) continue;
    const role = typeof raw.role === "string" ? raw.role : "unknown";
    const blocks = Array.isArray(raw.content) ? raw.content : [raw.content];
    let textIndex = 0;
    let toolIndex = 0;

    for (const block of blocks) {
      if (isRecord(block) && block.type === "tool_result") {
        const text = contentToText(block.content);
        if (!text) continue;
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        const segment: ContextSegmentInput = {
          id: `message.${messageIndex}.tool.${toolIndex}`,
          type: "tool",
          source: toolUseId ? `tool:${toolUseId}` : "anthropic.tool_result",
          content: text,
          metadata: { originalRole: role, blockType: "tool_result" }
        };
        segments.push(segment);
        toolIndex += 1;
        continue;
      }

      if (isRecord(block) && block.type === "tool_use") {
        const name = typeof block.name === "string" ? block.name : "tool";
        const text = JSON.stringify({ name, input: block.input ?? null });
        segments.push({
          id: `message.${messageIndex}.tool-use.${toolIndex}`,
          type: "history",
          source: `tool-call:${name}`,
          content: text,
          metadata: { originalRole: role, blockType: "tool_use" }
        });
        toolIndex += 1;
        continue;
      }

      const text = contentToText(block);
      if (!text) continue;
      const type = categoryForRole(role, messageIndex === lastUserIndex);
      segments.push({
        id: `message.${messageIndex}.text.${textIndex}`,
        type,
        source: `anthropic.${role}`,
        content: text,
        protected: type === "system" || type === "developer" || type === "user",
        metadata: { originalRole: role, blockType: isRecord(block) && typeof block.type === "string" ? block.type : "text" }
      });
      textIndex += 1;
    }
  }

  return makeTrace(segments, value, options, "anthropic");
}

function messagesToTrace(
  input: unknown,
  options: NormalizeTraceOptions,
  format: "openai" | "messages"
): PAUTrace {
  const messages = extractMessages(input);
  if (!messages) throw new Error("Message input must provide an array or a messages array.");
  const segments: ContextSegmentInput[] = [];
  const lastUserIndex = findLastRole(messages, "user");

  for (let index = 0; index < messages.length; index += 1) {
    const raw = messages[index] as MessageLike;
    if (!isRecord(raw)) continue;
    const role = typeof raw.role === "string" ? raw.role : "unknown";
    let content = contentToText(raw.content);
    if (!content && raw.tool_calls !== undefined) content = JSON.stringify(raw.tool_calls);
    if (!content) continue;

    const type = role === "tool" ? "tool" : categoryForRole(role, index === lastUserIndex);
    const source = resolveMessageSource(raw, role, format);
    const segment: ContextSegmentInput = {
      id: `message.${index}`,
      type,
      source,
      content,
      protected: type === "system" || type === "developer" || type === "user",
      metadata: { originalRole: role }
    };
    segments.push(segment);
  }

  return makeTrace(segments, input, options, format === "messages" ? "messages" : "openai");
}

function normalizePAUTrace(input: unknown, options: NormalizeTraceOptions): PAUTrace {
  if (!isRecord(input) || !Array.isArray(input.segments)) throw new Error("Invalid PAU trace.");
  const trace = input as unknown as PAUTrace;
  const normalized: PAUTrace = {
    version: options.version ?? trace.version ?? "0.2",
    segments: trace.segments.map((segment) => ({ ...segment }))
  };
  const analysisMode = options.analysisMode ?? trace.analysisMode;
  if (analysisMode !== undefined) normalized.analysisMode = analysisMode;
  assignTraceMetadata(normalized, trace, options);
  return normalized;
}

function makeTrace(
  segments: ContextSegmentInput[],
  original: unknown,
  options: NormalizeTraceOptions,
  providerFallback: string
): PAUTrace {
  const source = isRecord(original) ? original : {};
  const trace: PAUTrace = {
    version: options.version ?? "0.2",
    analysisMode: options.analysisMode ?? "heuristic",
    segments
  };
  const inferred: Partial<PAUTrace> = { provider: stringValue(source.provider) ?? providerFallback };
  const runId = stringValue(source.runId ?? source.id);
  const model = stringValue(source.model);
  const tokenizer = stringValue(source.tokenizer);
  const traceBoundary = stringValue(source.traceBoundary);
  const contextWindow = numberValue(source.contextWindow ?? source.context_window);
  const turn = numberValue(source.turn);
  if (runId !== undefined) inferred.runId = runId;
  if (model !== undefined) inferred.model = model;
  if (tokenizer !== undefined) inferred.tokenizer = tokenizer;
  if (traceBoundary !== undefined) inferred.traceBoundary = traceBoundary;
  if (contextWindow !== undefined) inferred.contextWindow = contextWindow;
  if (turn !== undefined) inferred.turn = turn;
  assignTraceMetadata(trace, inferred, options);
  return trace;
}

function assignTraceMetadata(
  target: PAUTrace,
  source: Partial<PAUTrace>,
  options: NormalizeTraceOptions
): void {
  const runId = options.runId ?? source.runId;
  const model = options.model ?? source.model;
  const provider = options.provider ?? source.provider;
  const tokenizer = options.tokenizer ?? source.tokenizer;
  const traceBoundary = options.traceBoundary ?? source.traceBoundary;
  const contextWindow = options.contextWindow ?? source.contextWindow;
  const turn = options.turn ?? source.turn;

  if (runId !== undefined) target.runId = runId;
  if (model !== undefined) target.model = model;
  if (provider !== undefined) target.provider = provider;
  if (tokenizer !== undefined) target.tokenizer = tokenizer;
  if (traceBoundary !== undefined) target.traceBoundary = traceBoundary;
  if (contextWindow !== undefined) target.contextWindow = contextWindow;
  if (turn !== undefined) target.turn = turn;
}

function categoryForRole(role: string, isCurrentUser: boolean): ContextCategory {
  if (role === "system") return "system";
  if (role === "developer") return "developer";
  if (role === "user" && isCurrentUser) return "user";
  if (role === "tool") return "tool";
  return "history";
}

function resolveMessageSource(message: MessageLike, role: string, format: string): string {
  if (typeof message.name === "string") return `${format}.${role}:${message.name}`;
  if (typeof message.tool_call_id === "string") return `${format}.tool:${message.tool_call_id}`;
  return `${format}.${role}`;
}

function findLastRole(messages: unknown[], role: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === role) return index;
  }
  return -1;
}

function extractMessages(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.messages)) return value.messages;
  return null;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content.map((item) => contentToText(item)).filter(Boolean).join("\n").trim();
  }
  if (isRecord(content)) {
    if (typeof content.text === "string") return content.text.trim();
    if (typeof content.content === "string") return content.content.trim();
    if (Array.isArray(content.content)) return contentToText(content.content);
    if (content.type === "image" || content.type === "image_url" || content.type === "input_image") {
      return "[image content]";
    }
    if (content.type === "tool_use") return JSON.stringify({ name: content.name ?? "tool", input: content.input ?? null });
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content).trim();
}

function parseUnknown(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
