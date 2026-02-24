import { asyncHandler } from "../utils/http.js";

export const getSimpleContent = asyncHandler(async (_req, res) => {
  return res.json({
    type: "simple",
    title: "Daily Whisper",
    content:
      "Consistency is sacred. Roz ke chhote steps hi long-term transformation banate hain.",
  });
});

export const getPremiumContent = asyncHandler(async (req, res) => {
  return res.json({
    type: "premium",
    title: "Golden Insight",
    content:
      `Premium link active, ${req.user.name}. ` +
      "Aaj ka task: apne goal ko 3 micro-milestones mein tod do, har milestone ka deadline likho.",
  });
});
