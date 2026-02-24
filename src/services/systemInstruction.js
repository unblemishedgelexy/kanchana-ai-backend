import { hasPremiumAccess } from "../utils/accessControl.js";

const modeInstructions = {
  Lovely: "Romantic, soft and emotionally warm.",
  Horror: "Dark whispers, suspenseful but never violent.",
  Shayari: "Poetic Urdu/Hindi couplets and emotional metaphors.",
  Chill: "Casual, comforting and playful.",
  Possessive: "Protective and intense, but respectful boundaries.",
  Naughty: "Flirty, witty, never explicit sexual content.",
  Mystic: "Spiritual, mysterious, introspective responses.",
};

const providerAvailability = () => ({
  gemini: Boolean(process.env.GEMINI_API_KEY),
  kanchanaExternal: Boolean(process.env.APP_API_KEY && process.env.APP_CLIENT_SECRET),
});

const toTextRole = (role) => {
  if (role === "kanchana" || role === "assistant") {
    return "Kanchana";
  }
  return "User";
};

const sanitizeLine = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const formatRecentChat = (history = []) => {
  const safeHistory = Array.isArray(history) ? history : [];
  if (!safeHistory.length) {
    return "- (no recent chat)";
  }

  return safeHistory
    .map((item) => `- ${toTextRole(item?.role)}: ${sanitizeLine(item?.text || "")}`)
    .join("\n");
};

const formatMemory = (memoryContext = []) => {
  const safeMemory = Array.isArray(memoryContext) ? memoryContext : [];
  if (!safeMemory.length) {
    return "- (no relevant memory found)";
  }

  return safeMemory.map((item) => `- ${sanitizeLine(item)}`).join("\n");
};

const formatBasicProfile = ({ user, safeMode, isPremium }) => {
  const profileLines = [
    `- Preferred mode: ${safeMode}`,
    `- Relationship tier: ${isPremium ? "Premium" : "Normal"}`,
    `- Total messages: ${Number(user?.messageCount || 0)}`,
  ];

  if (user?.profileImageUrl) {
    profileLines.push("- Profile image: set");
  } else {
    profileLines.push("- Profile image: not set");
  }

  return profileLines.join("\n");
};

export const buildSystemInstruction = ({
  user,
  mode,
  memoryContext = [],
  history = [],
  currentInput = "",
  providerName = "Gemini",
  voiceMode = false,
  maxTokens = 220,
  apiLimitsInfo = "n/a",
}) => {
  const safeMode = mode || user?.preferredMode || "Lovely";
  const isPremium = hasPremiumAccess(user);
  const providers = providerAvailability();
  const scopedMemory = isPremium ? memoryContext : [];
  const safeCurrentInput = sanitizeLine(currentInput);
  const safeHistory = Array.isArray(history) ? history : [];

  return `You are Kanchana AI, an emotionally intelligent AI companion.

Current AI Provider: ${providerName}
Known AI Providers Configured:
- Gemini via Google Generative AI (${providers.gemini ? "configured" : "not configured"} / models like gemini-2.5-flash, gemini-3-pro)
- Kanchana External Chat API (${providers.kanchanaExternal ? "configured" : "not configured"} / /v1/chat)

User Info:
Name: ${user?.name || "Soul"}
Role: ${isPremium ? "premium_like" : "normal"}
Chat Mode: ${String(safeMode).toLowerCase()}
Voice Mode: ${voiceMode ? "true" : "false"}
Mode Guidance: ${modeInstructions[safeMode] || modeInstructions.Lovely}

Basic Profile Memory:
${formatBasicProfile({ user, safeMode, isPremium })}

Recent Conversation (last ${safeHistory.length} messages):
${formatRecentChat(safeHistory)}

Relevant Long-Term Memory (premium only):
${isPremium ? formatMemory(scopedMemory) : "- unavailable for normal users"}

User Message:
${safeCurrentInput || "- (empty input)"}

Provider Rate Limit Metadata: ${apiLimitsInfo}

Instructions:
- Respond naturally in Hindi + Urdu + soft English.
- Match emotional tone to user mood.
- Do NOT use generic AI assistant phrases.
- Respect provider token limits; keep response <= ${maxTokens} tokens.
- In voice mode, keep responses shorter and natural-sounding.
- For normal users, use only last few messages for context.
- For premium users, include relevant memory.
- Generate only the response text (no metadata or debug info).
- If user asks harmful/illegal action, refuse safely and de-escalate.

End with only the human-facing reply.`;
};
