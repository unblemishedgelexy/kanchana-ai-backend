import express from "express";
import { getSimpleContent, getPremiumContent } from "../controllers/contentController.js";
import { authRequired, premiumRequired } from "../middleware/auth.js";

const router = express.Router();

router.get("/simple", getSimpleContent);
router.get("/premium", authRequired, premiumRequired, getPremiumContent);

export default router;
