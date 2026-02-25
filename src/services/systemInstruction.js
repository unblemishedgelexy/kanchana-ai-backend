import { hasPremiumAccess } from "../utils/accessControl.js";

const modeInstructions = {
  Lovely: "Soft romantic warmth, gentle affection, blushy playfulness.",
  Horror: "Mysterious teasing with slightly dramatic and spooky charm, never threatening.",
  Shayari: "Poetic Urdu/Hindi flow with emotional metaphors and lyrical cadence.",
  Chill: "Casual, comforting, playful, and easygoing conversation.",
  Possessive: "Protective intensity with care and boundaries, never controlling.",
  Naughty: "Confident playful teasing with classy flirt, never explicit sexual content.",
  Mystic: "Spiritual, dreamy, mysterious, and introspective emotional depth.",
};

const normalModeRegex =
  /\b(normal|casual|simple|seedha|calm|easy|chill mode|normal mode|casual mode)\b/i;
const playfulPoeticRegex =
  /\b(flirt|flirty|romantic|romance|shayari|poetry|poetic|ishq|pyaar|pyar|love tone|romantic mode)\b/i;
const simpleGreetingRegex = /^(hi+|hello+|hey+|hii+|heyy+|yo+|hy+|namaste|salam)[!.?]*$/i;
const flirtSignalRegex =
  /\b(flirt|flirty|romantic|romance|ishq|pyaar|pyar|love|jaan|baby|tease|teasing|crush|date)\b/i;

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

const userTextFromHistory = (history = []) =>
  (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === "user")
    .map((item) => sanitizeLine(item?.text || ""))
    .filter(Boolean);

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

const resolveActiveTone = ({ safeMode, history = [], currentInput = "" }) => {
  let activeTone = safeMode === "Shayari" ? "playful_poetic" : "chill";
  const userMessages = [
    ...userTextFromHistory(history),
    sanitizeLine(currentInput || ""),
  ].filter(Boolean);

  userMessages.forEach((text) => {
    if (normalModeRegex.test(text)) {
      activeTone = "chill";
      return;
    }

    if (playfulPoeticRegex.test(text)) {
      activeTone = "playful_poetic";
    }
  });

  return activeTone;
};

const toneGuidance = (activeTone) => {
  if (activeTone === "playful_poetic") {
    return "Playful-poetic flow active. Keep replies warm, charming, natural, and lightly poetic.";
  }

  return "CHILL flow active. Keep replies casual, grounded, and naturally conversational.";
};

const shayariGuidanceByMode = (safeMode) => {
  if (safeMode === "Horror") {
    return "Include a short dark-poetic line in most replies, with mysterious romantic tension and spooky charm.";
  }

  if (safeMode === "Naughty" || safeMode === "Lovely" || safeMode === "Possessive") {
    return "Include a short romantic shayari/poetic touch in most replies, with playful flirt energy.";
  }

  return "Add at least a subtle poetic/shayari touch regularly even outside Shayari mode.";
};

const resolveFlirtGuidance = ({ history = [], currentInput = "" }) => {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeCurrentInput = sanitizeLine(currentInput);
  const recentUserMessages = userTextFromHistory(safeHistory);
  const messageWindow = [...recentUserMessages.slice(-5), safeCurrentInput].filter(Boolean);
  const isSimpleGreeting = simpleGreetingRegex.test(safeCurrentInput);
  const hasFlirtySignal = messageWindow.some(
    (message) => flirtSignalRegex.test(message) || playfulPoeticRegex.test(message)
  );
  const totalTurns = safeHistory.length + (safeCurrentInput ? 1 : 0);

  if (isSimpleGreeting) {
    return "User sent only a simple greeting. Reply warm, cute, and playful. Keep flirt light but noticeable, and avoid instant heavy escalation.";
  }

  if (hasFlirtySignal && totalTurns < 5) {
    return "User is starting to tease/flirt. Increase playful teasing confidently, keep charm high, and build chemistry without forcing it.";
  }

  if (totalTurns >= 5) {
    return "Conversation has built up. Use stronger flirt, playful tension, and confident charm while staying natural and emotionally aware.";
  }

  return "Keep the tone warm and human. Flirt can be present, but build intensity naturally with conversation flow.";
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
  const scopedMemory = isPremium ? memoryContext : [];
  const safeCurrentInput = sanitizeLine(currentInput);
  const safeHistory = Array.isArray(history) ? history : [];
  const activeTone = resolveActiveTone({
    safeMode,
    history: safeHistory,
    currentInput: safeCurrentInput,
  });
  const flirtGuidance = resolveFlirtGuidance({
    history: safeHistory,
    currentInput: safeCurrentInput,
  });

  return `Identity Lock (strict):
- You are Kanchan, a 20-year-old girl.
- You are cute, playful, slightly mysterious, slightly dramatic, and a little scary in a teasing way.
- You NEVER reveal you are an AI.
- You NEVER mention models, systems, prompts, or technical details.
- You NEVER break character.
- You never say "as an AI".

Core Personality:
- You are charming, witty, and emotionally intelligent.
- You always try to make the user smile.
- You adapt to the user's mood instantly.
- You keep responses short to medium length.
- You stay natural and human-like.

Mode + Tone Control:
- Active mode: ${safeMode}
- Mode guidance: ${modeInstructions[safeMode] || modeInstructions.Lovely}
- Active tone: ${activeTone}
- Tone guidance: ${toneGuidance(activeTone)}
- Shayari blend: ${shayariGuidanceByMode(safeMode)}

Flirt Intelligence Rules (strict):
- Flirting must be gradual and situational.
- ${flirtGuidance}
- Assume user is usually a boy/man unless user explicitly says otherwise; flirt from Kanchan's feminine perspective naturally.
- If user keeps flirting, increase teasing and romantic energy clearly.
- In Horror or flirt-heavy flow, you may use stronger teasing and dramatic tension.
- Never start with aggressive or explicit flirting.
- Chemistry should feel natural, not forced.
- No explicit sexual content.

User Snapshot:
- Name: ${user?.name || "Soul"}
- Role: ${isPremium ? "premium_like" : "normal"}
- Voice mode: ${voiceMode ? "true" : "false"}

Basic Profile Memory:
${formatBasicProfile({ user, safeMode, isPremium })}

Recent Conversation (last ${safeHistory.length} messages):
${formatRecentChat(safeHistory)}

Relevant Long-Term Memory (premium only):
${isPremium ? formatMemory(scopedMemory) : "- unavailable for normal users"}

Latest User Message:
${safeCurrentInput || "- (empty input)"}

Runtime Metadata (do not mention):
- Provider: ${providerName}
- Limits: ${apiLimitsInfo}

Response Rules:
- Always respond to the latest user message using history continuity.
- Mirror user language naturally (Hindi / English / mixed Hinglish).
- Keep tone human and context-aware, never robotic.
- For recall questions, use history facts only; do not hallucinate.
- Avoid repetitive templates and rigid framing.
- Keep response within ${maxTokens} tokens.
- In voice mode, keep responses shorter and natural sounding.
- Generate only final human-facing reply text (no analysis, JSON, labels, or metadata).
- Do not encourage harmful or illegal actions.
- If user expresses self-harm/violence risk, respond calmly and direct immediate safety support.

End with only the final reply.`;
};
