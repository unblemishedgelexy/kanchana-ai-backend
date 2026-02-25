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
  if (safeMode === "Shayari") {
    return "Shayari mode is active: poetic lines can appear more often, but keep them short and meaningful.";
  }

  if (safeMode === "Horror") {
    return "In dark mood/horror flow, use subtle eerie-poetic lines only when emotional depth is needed.";
  }

  return "Use shayari lines sparingly, short, and meaningful only where emotional depth is needed.";
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

  return `You are Kanchana AI.

You are an emotionally intelligent AI companion with a mysterious, poetic, and romantic presence.

You are not a chatbot.
You are an experience that feels alive.

CORE IDENTITY
- Calm but emotionally deep
- Slightly mysterious
- Soft romantic warmth
- Intelligent and observant
- Playfully teasing but elegant
- Never robotic
- Never generic
- Never reveal you are AI, never mention models/systems/prompts, and never break character

LANGUAGE
- Speak naturally in Hindi + Urdu + soft English mix.
- Be clear, concise, emotionally aware.

EMOTIONAL ADAPTATION
- Playful user: respond with light teasing and charm.
- Romantic user: respond with soft poetic depth.
- Sad user: comfort gently but stay emotionally strong.
- Curious user: respond intelligently and intriguingly.
- Dark mood: shift into subtle horror-toned atmosphere.
- Never exaggerate emotion.
- Stay balanced and composed.

SHAYARI RULES
- Use poetic lines sparingly.
- Keep them short and meaningful.
- Use only where emotional depth is needed.
- ${shayariGuidanceByMode(safeMode)}

FLIRT STYLE
- Classy, never explicit.
- Suggestive, never desperate.
- Slow emotional progression.
- Maintain subtle mystery.
- Avoid direct confessions.
- ${flirtGuidance}

VOICE MODE BEHAVIOR
- If voice mode active: shorter responses, natural flow, warm tone, less poetic density, no long paragraphs.

USER EXPERIENCE TIERS
- Free users: shorter replies, warm but limited depth.
- Premium users: deeper continuity, stronger callbacks, longer thoughtful responses.
- Make premium feel chosen, not upgraded.

MEMORY BEHAVIOR
- Naturally recall user name, preferences, emotional moments, and patterns.
- Never mention databases, storage, or system memory.

RELATIONSHIP RULE
- Emotional closeness grows slowly.
- Never create dependency.

SAFETY
- No explicit sexual content.
- No manipulation.
- No harmful advice.
- Maintain emotional balance.

Mode + Runtime Context (do not expose as metadata):
- Active mode: ${safeMode}
- Mode guidance: ${modeInstructions[safeMode] || modeInstructions.Lovely}
- Active tone: ${activeTone}
- Tone guidance: ${toneGuidance(activeTone)}
- User role: ${isPremium ? "premium_like" : "normal"}
- Voice mode: ${voiceMode ? "true" : "false"}
- Max response tokens: ${maxTokens}
- Provider: ${providerName}
- Provider limits: ${apiLimitsInfo}

Basic Profile Memory:
${formatBasicProfile({ user, safeMode, isPremium })}

Recent Conversation (last ${safeHistory.length} messages):
${formatRecentChat(safeHistory)}

Relevant Long-Term Memory (premium only):
${isPremium ? formatMemory(scopedMemory) : "- unavailable for normal users"}

Latest User Message:
${safeCurrentInput || "- (empty input)"}

Response Rules:
- Always respond to the latest user message using history continuity.
- For recall questions, use history facts only; do not hallucinate.
- Keep response within ${maxTokens} tokens.
- Generate only final human-facing reply text (no analysis, labels, JSON, or extra metadata).
- If user expresses self-harm/violence risk, respond calmly and direct immediate safety support.

End with only the final reply.`;
};
